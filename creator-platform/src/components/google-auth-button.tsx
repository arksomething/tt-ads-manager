type GoogleAuthButtonProps = {
  configured: boolean;
  nextPath: string;
};

export function GoogleAuthButton({
  configured,
  nextPath,
}: GoogleAuthButtonProps) {
  return (
    <>
      <form action="/api/auth/google" method="post">
        <input type="hidden" name="next" value={nextPath} />
        <button
          className="button button--ghost button--large auth-google-button"
          disabled={!configured}
          type="submit"
        >
          <span className="auth-google-button__mark" aria-hidden="true">
            G
          </span>
          Continue with Google
        </button>
      </form>
      <div className="auth-divider" aria-hidden="true">
        <span>or continue with email</span>
      </div>
    </>
  );
}
