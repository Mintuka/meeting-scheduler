# Google OAuth Setup Instructions

## Fix Redirect URI Mismatch Error

If you're getting `Error 400: redirect_uri_mismatch`, you need to add the correct redirect URI to your Google Cloud Console.

### Current Configuration

Your code uses: `http://localhost:8000/api/google/callback`

But your Google Cloud Console only has:
- `http://localhost:3000/`
- `http://localhost:8000`

### Steps to Fix

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project: `secure-portal-454818-g0`
3. Navigate to: **APIs & Services** → **Credentials**
4. Find your OAuth 2.0 Client ID (it will look like: `YOUR_CLIENT_ID.apps.googleusercontent.com`)
5. Click **Edit** (pencil icon)
6. Under **Authorized redirect URIs**, click **+ ADD URI**
7. Add this exact URI: `http://localhost:8000/api/google/callback`
8. Click **Save**
9. Wait a few minutes for changes to propagate

### Complete List of Redirect URIs

After updating, your **Authorized redirect URIs** should include:
- `http://localhost:3000/`
- `http://localhost:8000`
- `http://localhost:8000/api/google/callback` ← **ADD THIS ONE**

### Verify Configuration

Your `docker.env` should have:
```env
GOOGLE_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=YOUR_CLIENT_SECRET
GOOGLE_REDIRECT_URI=http://localhost:8000/api/google/callback
```

**Note:** Replace `YOUR_CLIENT_ID` and `YOUR_CLIENT_SECRET` with your actual values from Google Cloud Console.

### After Updating

1. Restart your backend server
2. Try signing in again
3. The redirect URI mismatch error should be resolved

### Alternative: Use Frontend Redirect (Not Recommended)

If you can't update Google Cloud Console, you could change the code to use `http://localhost:3000/auth/callback` and handle the OAuth callback in the frontend, but this is more complex and less secure.

