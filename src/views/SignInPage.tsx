import { useState, type FormEvent } from "react";
import { useAsyncAction } from "../controllers/useAsyncAction";
import { ErrorMessage } from "./components";

export function SignInPage({
  onSignIn,
  onSignUp,
}: {
  onSignIn: (email: string, password: string) => Promise<void>;
  /** Resolves true when the user must confirm their email first. */
  onSignUp: (email: string, password: string) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmSent, setConfirmSent] = useState(false);
  const signIn = useAsyncAction(onSignIn);
  const signUp = useAsyncAction(onSignUp);
  const action = mode === "signIn" ? signIn : signUp;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mode === "signIn") {
      await signIn.run(email.trim(), password);
      return;
    }
    const result = await signUp.run(email.trim(), password);
    if (result.ok && result.value) setConfirmSent(true);
  };

  return (
    <section className="page-view stack" aria-labelledby="sign-in-title">
      <header className="page-heading">
        <p className="eyebrow">Welcome</p>
        <h1 id="sign-in-title">{mode === "signIn" ? "Sign in" : "Create account"}</h1>
        <p>Your budget is private to your household.</p>
      </header>

      {confirmSent ? (
        <p className="notice" role="status">
          Check {email} for a confirmation link, then come back and sign in.
        </p>
      ) : (
        <form className="list-card form" onSubmit={submit}>
          <label className="field">
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="field">
            Password
            <input
              type="password"
              autoComplete={mode === "signIn" ? "current-password" : "new-password"}
              required
              minLength={mode === "signUp" ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="primary-button" type="submit" disabled={action.pending}>
            {mode === "signIn" ? "Sign in" : "Create account"}
          </button>
          <ErrorMessage error={action.error} />
        </form>
      )}

      <button
        className="text-button"
        type="button"
        onClick={() => {
          setMode(mode === "signIn" ? "signUp" : "signIn");
          setConfirmSent(false);
        }}
      >
        {mode === "signIn" ? "New here? Create an account" : "Have an account? Sign in"}
      </button>
    </section>
  );
}
