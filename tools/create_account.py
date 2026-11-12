"""Create one preconfirmed review account without sending email or saving secrets.

Run locally; paste the Supabase secret key only into the hidden prompt.
Use --reviewer TEST for the coordinator test account, or A01..A06/C01..C06.
"""
import argparse
import getpass
import json
import urllib.error
import urllib.request

URL = 'https://tcibyolqmgpzvspiyfbk.supabase.co'


def main():
    p = argparse.ArgumentParser(); p.add_argument('--reviewer', required=True, choices=['TEST'] + [f'{g}{n:02d}' for g in 'AC' for n in range(1, 7)])
    p.add_argument('--email', required=True); args = p.parse_args()
    key = getpass.getpass('Supabase secret key (hidden; never saved): ')
    password = getpass.getpass('New reviewer password (hidden; never saved): ')
    if password != getpass.getpass('Repeat password: '):
        raise SystemExit('Passwords differ. No account created.')
    if len(password) < 12:
        raise SystemExit('Use at least 12 characters. No account created.')

    def request(path, data):
        req = urllib.request.Request(URL + path, data=json.dumps(data).encode(), headers={'apikey': key, 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            # API error text can contain account details. Keep terminal output minimal.
            raise SystemExit(f'Account setup returned HTTP {exc.code}. Inspect Supabase before retrying; no automatic retry was made.') from None
        except (TimeoutError, urllib.error.URLError):
            raise SystemExit('Request outcome is unknown. Inspect Supabase before retrying; no automatic retry was made.') from None

    created = request('/auth/v1/admin/users', dict(email=args.email, password=password, email_confirm=True))
    user_id = created.get('id') or created.get('user', {}).get('id')
    if not user_id:
        raise SystemExit('Account response had no user ID. Inspect Supabase before continuing.')
    for code in ['TEST-A', 'TEST-C'] if args.reviewer == 'TEST' else [args.reviewer]:
        request('/rest/v1/rpc/review_admin_bind_account', dict(p_reviewer_code=code, p_user_id=user_id))
    print('Account created and linked. No email was sent; no key or password was saved.')


if __name__ == '__main__':
    main()
