# Gmail API Setup (Drafts Only)

This guide configures one-time OAuth so local scripts can create Gmail drafts in your account.

## 1) Create Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project picker (top bar) -> **New Project**.
3. Name it something like `flya-allrounder-drafts`.
4. Click **Create** and switch to that project.

## 2) Enable Gmail API

1. In the left menu, go to **APIs & Services** -> **Library**.
2. Search for **Gmail API**.
3. Open it and click **Enable**.

## 3) Configure OAuth consent screen

1. Go to **APIs & Services** -> **OAuth consent screen**.
2. Choose **External** (recommended for personal use) and continue.
3. Fill required fields:
   - App name: `Flya Space`
   - User support email: your email
   - Developer contact email: your email
4. Save and continue through scopes/test users.
5. Add your own Gmail address as a **Test user** if prompted.

## 4) Create OAuth desktop credentials

1. Go to **APIs & Services** -> **Credentials**.
2. Click **Create Credentials** -> **OAuth client ID**.
3. Application type: **Desktop app**.
4. Name it: `flya-allrounder-local`.
5. Click **Create**, then **Download JSON**.
6. Save the file as:

```text
credentials.json
```

7. Place it at:

```text
scripts/credentials.json
```

## 5) Install Python dependencies

From project root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib
```

## 6) Run one-time auth

From project root:

```bash
python3 scripts/gmail_bridge.py auth
```

What happens:
- Browser opens Google login.
- You sign in to the Gmail account where drafts should be created.
- You approve only `gmail.compose` scope.
- Token is stored locally at `scripts/token.json`.

## 7) Create a test draft

```bash
python3 scripts/gmail_bridge.py create-draft \
  --to "your-test@example.com" \
  --subject "Draft API test" \
  --body "Hello from Flya Space."
```

Check Gmail -> **Drafts**.

## Security notes

- Script only requests:
  - `https://www.googleapis.com/auth/gmail.compose`
- No auto-send endpoint is used.
- Keep these files private:
  - `scripts/credentials.json`
  - `scripts/token.json`

## Recommended `.gitignore`

If you later make this folder a git repo, include:

```text
scripts/credentials.json
scripts/token.json
.venv/
```
