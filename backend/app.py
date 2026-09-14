"""Local-only HTTP bridge between the Electron app and a released OMR model.

python3 backend/app.py --bundle ml/data/releases/baseline-14drum-v1 [--port 8765]

Binds to 127.0.0.1 only and loads the bundle once at startup. A missing or inconsistent
bundle stops startup with a readable message instead of failing on the first request.
Electron's main process should call this service and poll GET /health for readiness.
"""

import argparse
import json
import socket
import sys
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from omr_bundle import BundleError, ImageInputError, load_bundle, predict

HOST = '127.0.0.1'
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
IMAGE_ERROR_STATUS = {'unsupported_file': 415, 'invalid_image': 422, 'image_too_large': 413}


def error_response(status, code, message):
    return JSONResponse(status_code=status,
                        content={'error': {'code': code, 'message': message}})


def create_app(bundle):
    app = FastAPI(title='DrumHub OMR service', docs_url=None, redoc_url=None, openapi_url=None)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, error):
        return error_response(422, 'missing_image',
                              'Send one PNG or JPEG bar image in the multipart field "image"')

    @app.get('/health')
    def health():
        return {'status': 'ok', 'model_sha256': bundle.model_sha256,
                'grid_slots': bundle.config['N_BEATS'],
                'drums': bundle.config['DRUMS'], 'durations': bundle.config['DURATIONS'],
                'max_upload_bytes': MAX_UPLOAD_BYTES}

    @app.post('/predict')
    def predict_bar(image: UploadFile = File(...)):
        data = image.file.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            return error_response(413, 'file_too_large', 'Images must be '
                                  f'{MAX_UPLOAD_BYTES / 1024 ** 2:g} MB or smaller')
        try:
            notes = predict(bundle, data)
        except ImageInputError as error:
            return error_response(IMAGE_ERROR_STATUS[error.code], error.code, str(error))
        except BundleError as error:
            return error_response(500, 'invalid_model_output', str(error))
        return {'notes': notes, 'model_sha256': bundle.model_sha256}

    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True,
                        help='folder containing omr.onnx and omr_config.json')
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    if args.port != 0 and not 1024 <= args.port <= 65535:
        parser.error('--port must be 0 or between 1024 and 65535')
    try:
        bundle = load_bundle(args.bundle)
    except BundleError as error:
        print(f'OMR service could not start: {error}', file=sys.stderr)
        return 1
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind((HOST, args.port))
        listener.listen(128)
        print(json.dumps({'port': listener.getsockname()[1],
                          'model_sha256': bundle.model_sha256}), flush=True)
        server = uvicorn.Server(uvicorn.Config(create_app(bundle), log_level='warning'))
        server.run(sockets=[listener])
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
