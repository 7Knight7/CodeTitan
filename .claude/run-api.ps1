# Local dev only: starts the API with the local test password "test1".
$env:LBC_PASSWORD_HASH = (python api/_lbc/auth.py test1).Trim()
# Fixed local secret so sign-ins survive the API reloading after code edits (never use in production).
$env:LBC_SESSION_SECRET = "local-dev-3213ef8eae93f423ff31006f8362ee3888aacb3acd1c1e69"
npm run api
