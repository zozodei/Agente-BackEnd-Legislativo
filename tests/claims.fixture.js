export function verifiedClaims(sub) {
  return {
    data: {
      claims: {
        sub,
        iss: 'https://test-project.supabase.co/auth/v1',
        aud: 'authenticated',
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
    },
    error: null,
  };
}
