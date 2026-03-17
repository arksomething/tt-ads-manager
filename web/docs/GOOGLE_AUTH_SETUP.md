# Google OAuth setup

To enable "Continue with Google" on the login page you need a **Client ID** and **Client Secret** from Google Cloud, then set them in `web/.env.local`.

## 1. Create OAuth credentials in Google Cloud

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (or pick an existing one) and ensure the **APIs & Services** API is available.
3. Go to **APIs & Services** → **Credentials**.
4. Click **Create credentials** → **OAuth client ID**.
5. If asked, configure the **OAuth consent screen**:
   - Choose **External** (or Internal for a workspace-only app).
   - Fill in **App name** (e.g. "Billion Views"), **User support email**, and **Developer contact**.
   - Add your email under **Test users** if the app is in Testing mode.
6. Back in **Create OAuth client ID**:
   - Application type: **Web application**.
   - Name: e.g. "Billion Views (local)".
   - Under **Authorized redirect URIs** click **Add URI** and add:
     - **Local:** `http://localhost:3000/api/auth/callback/google`
     - If your dev server runs on another port (e.g. 3001), also add: `http://localhost:3001/api/auth/callback/google`
     - **Production:** `https://your-domain.com/api/auth/callback/google` (when you deploy).
7. Click **Create**. Copy the **Client ID** and **Client Secret**.

## 2. Set environment variables

In `web/.env.local` set:

```bash
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-client-secret"
```

Ensure `AUTH_URL` matches how you open the app (e.g. `http://localhost:3000` or `http://localhost:3001` if that’s the port in use).

## 3. Restart the app

Restart the Next.js dev server so it picks up the new env vars. The login page should show "Continue with Google" as active and the "auth is currently disabled" message will disappear.

## Troubleshooting

- **Redirect URI mismatch:** The URI in Google Cloud must match exactly (including `http` vs `https`, port, and path `/api/auth/callback/google`).
- **Consent screen:** If the app is in Testing, only users listed as Test users can sign in until you submit for verification.
