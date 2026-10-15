import { useState, type FormEvent } from "react";
import { useAsyncAction } from "../controllers/useAsyncAction";
import { ErrorMessage } from "./components";

/** Sign-in only: accounts are added by the owner in Supabase (public sign-up is off). */
export function SignInPage({
  onSignIn,
}: {
  onSignIn: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const signIn = useAsyncAction(onSignIn);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await signIn.run(email.trim(), password);
  };

  return (
    <section className="page-view stack" aria-labelledby="sign-in-title">
      <header className="page-heading">
        <p className="eyebrow">Welcome</p>
        <h1 id="sign-in-title">Sign in</h1>
        <p>Your budget is private to your household.</p>
      </header>

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
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="primary-button" type="submit" disabled={signIn.pending}>
          Sign in
        </button>
        <ErrorMessage error={signIn.error} />
      </form>
    </section>
  );
}
