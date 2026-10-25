"""Lossless documentation encoding with decoded-pixel verification (WEBUI-DESIGN-R011)."""

import base64
import hashlib
import io
import json
import sys

import PIL
from PIL import Image, features


def inspect(image):
    """Reject color semantics we cannot preserve rather than stripping metadata."""
    if image.mode not in {'RGB', 'RGBA'}:
        raise ValueError('Only RGB/RGBA screenshots are supported')
    if any(
        key in image.info
        for key in ('icc_profile', 'exif', 'xmp', 'gamma', 'srgb', 'chromaticity')
    ):
        raise ValueError(
            'Screenshot color metadata requires explicit preservation support'
        )
    return {
        'width': image.width,
        'height': image.height,
        'rgbaSha256': hashlib.sha256(image.convert('RGBA').tobytes()).hexdigest(),
    }


def main():
    if PIL.__version__ != '12.3.0':
        raise ValueError(
            'Install the pinned scripts/screenshot-requirements.txt helper'
        )
    source = Image.open(io.BytesIO(sys.stdin.buffer.read()))
    if sys.argv[1] == 'inspect':
        if source.format != 'WEBP' or source.is_animated:
            raise ValueError('Expected one lossless WebP screenshot')
        print(json.dumps(inspect(source)))
        return
    if sys.argv[1] != 'encode' or source.format != 'PNG' or source.info:
        raise ValueError('Expected an unannotated PNG source screenshot')
    before = inspect(source)
    output = io.BytesIO()
    source.save(output, format='WEBP', lossless=True, method=6, exact=True)
    encoded = output.getvalue()
    decoded = Image.open(io.BytesIO(encoded))
    if (
        inspect(decoded) != before
        or decoded.convert('RGBA').tobytes() != source.convert('RGBA').tobytes()
    ):
        raise ValueError('Lossless screenshot pixel verification failed')
    print(
        json.dumps(
            {
                **before,
                'bytes': base64.b64encode(encoded).decode('ascii'),
                'optimizer': {
                    'pillow': PIL.__version__,
                    'libwebp': features.version('webp'),
                },
            }
        )
    )


if __name__ == '__main__':
    main()
