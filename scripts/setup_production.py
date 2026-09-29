"""Create a private production .env; never overwrite existing credentials.

Run after installing server dependencies:
python scripts/setup_production.py --domain diary.example.com --email owner@example.com
"""
import argparse
import base64
import os
import re
import secrets
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--domain', required=True)
    parser.add_argument('--email', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?', args.domain) or '.' not in args.domain:
        parser.error('Use a DNS name without https:// or a path.')
    if not re.fullmatch(r'[^\s@=$]+@[^\s@=$]+\.[^\s@=$]+', args.email):
        parser.error('Use a valid contact email.')
    target = Path(__file__).resolve().parents[1] / '.env'
    key = ec.generate_private_key(ec.SECP256R1())
    encode = lambda value: base64.urlsafe_b64encode(value).rstrip(b'=').decode()
    values = {
        'APP_DOMAIN': args.domain,
        'POSTGRES_PASSWORD': secrets.token_hex(32),
        'VAPID_PRIVATE_KEY': encode(key.private_numbers().private_value.to_bytes(32, 'big')),
        'VAPID_PUBLIC_KEY': encode(key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)),
        'VAPID_SUBJECT': 'mailto:' + args.email,
    }
    try:
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        parser.error('.env already exists. Existing passwords and push keys were left unchanged.')
    with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
        output.write(''.join(f'{name}={value}\n' for name, value in values.items()))
    print('Created private .env. Keep a secure backup; credentials were not printed.')


if __name__ == '__main__':
    main()
