import { FormEvent, useEffect, useState } from "react";
import {
  ApiError,
  AuthUser,
  LoginResponse,
  SignupResponse,
  TempLoginEmailResponse,
} from "@/app/types/interfaces";
import { useMemo } from "react";
import { Mode, MOBILE_FRAME_STYLE, APP_VIEWPORT_STYLE } from "@/app/components/utils";


export default function SignUpPage({
    setAuthUser,
}: {
    setAuthUser: (user: AuthUser) => void;
}) {
    const [mode, setMode] = useState<Mode>("login");
    const [statusMessage, setStatusMessage] = useState<string>("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSendingTempEmail, setIsSendingTempEmail] = useState(false);
    const [identifier, setIdentifier] = useState("");
    const [password, setPassword] = useState("");
    const [email, setEmail] = useState("");
    const [username, setUsername] = useState("");

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }
        const params = new URLSearchParams(window.location.search);
        const tok = params.get("temp_password");
        if (!tok) {
            return;
        }
        setPassword(tok);
        params.delete("temp_password");
        const next = params.toString();
        const path = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash}`;
        window.history.replaceState({}, "", path);
    }, []);

    const readApiError = async (response: Response): Promise<string> => {
        try {
            const body = (await response.json()) as ApiError;
            return body.error?.message ?? "Request failed.";
        } catch {
            return "Request failed.";
        }
    };

    const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setStatusMessage("");
        setIsSubmitting(true);

        try {
            const response = await fetch("/api/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ identifier, password }),
            });

            if (!response.ok) {
                setStatusMessage(await readApiError(response));
                return;
            }

            const payload = (await response.json()) as LoginResponse;
            setAuthUser(payload.user);
            setStatusMessage("");
        } finally {
            setIsSubmitting(false);
        }
    };

    const sendTempLoginEmail = async () => {
        const id = identifier.trim();
        if (!id) {
            setStatusMessage("Enter your username or email first.");
            return;
        }
        setStatusMessage("");
        setIsSendingTempEmail(true);
        try {
            const response = await fetch("/api/temp-login-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ identifier: id }),
            });

            if (!response.ok) {
                setStatusMessage(await readApiError(response));
                return;
            }

            const payload = (await response.json()) as TempLoginEmailResponse;
            setStatusMessage(payload.message);
        } finally {
            setIsSendingTempEmail(false);
        }
    };

    const submitSignup = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setStatusMessage("");
        setIsSubmitting(true);

        try {
            const response = await fetch("/api/signup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, email, password }),
            });

            if (!response.ok) {
                setStatusMessage(await readApiError(response));
                return;
            }

            const payload = (await response.json()) as SignupResponse;
            setAuthUser(payload.user);
            setStatusMessage("");
        } finally {
            setIsSubmitting(false);
        }
    };

    const pageTitle = useMemo(() => (mode === "login" ? "Log in" : "Create account"), [mode]);

    return (
        <main style={APP_VIEWPORT_STYLE} className="flex w-screen justify-center p-0">
            <section
                style={MOBILE_FRAME_STYLE}
                className="flex h-full flex-col justify-center border border-accent-1 bg-secondary-background px-6 shadow-lg shadow-black/20"
            >
                <h1 className="text-lg font-semibold text-foreground">{pageTitle}</h1>
                <p className="mt-1 text-sm text-accent-2">Single-page auth flow for mobile-first layout.</p>
                {mode === "signup" ? (
                    <p className="mt-3 text-sm text-accent-2">
                        Sorry ppl are dumb and I hate resetting passwords so enter your emails so we can automate it
                    </p>
                ) : null}

                {mode === "login" ? (
                    <form className="mt-6 flex flex-col gap-3" onSubmit={submitLogin}>
                        <input
                            className="rounded-xl border border-accent-1 bg-primary-background px-4 py-3 text-sm text-foreground outline-none focus:border-accent-2"
                            placeholder="Username or email"
                            value={identifier}
                            onChange={(event) => setIdentifier(event.target.value)}
                            autoCapitalize="none"
                            autoComplete="username"
                            required
                        />
                        <input
                            className="rounded-xl border border-accent-1 bg-primary-background px-4 py-3 text-sm text-foreground outline-none focus:border-accent-2"
                            placeholder="Password"
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            autoComplete="current-password"
                            required
                        />
                        <button
                            type="submit"
                            disabled={isSubmitting || isSendingTempEmail}
                            className="mt-2 rounded-xl bg-accent-3 px-4 py-3 text-sm font-semibold text-primary-background transition hover:brightness-110 disabled:opacity-60"
                        >
                            {isSubmitting ? "Logging in..." : "Log in"}
                        </button>
                        <button
                            type="button"
                            onClick={() => void sendTempLoginEmail()}
                            disabled={isSubmitting || isSendingTempEmail}
                            className="rounded-xl border border-accent-1 bg-primary-background px-4 py-3 text-sm font-medium text-foreground transition hover:border-accent-2 disabled:opacity-60"
                        >
                            {isSendingTempEmail ? "Sending…" : "Email me a temporary login code"}
                        </button>
                    </form>
                ) : (
                    <form className="mt-6 flex flex-col gap-3" onSubmit={submitSignup}>
                        <input
                            className="rounded-xl border border-accent-1 bg-primary-background px-4 py-3 text-sm text-foreground outline-none focus:border-accent-2"
                            placeholder="Username"
                            value={username}
                            onChange={(event) => setUsername(event.target.value)}
                            autoCapitalize="none"
                            autoComplete="username"
                            required
                        />
                        <input
                            className="rounded-xl border border-accent-1 bg-primary-background px-4 py-3 text-sm text-foreground outline-none focus:border-accent-2"
                            placeholder="Email"
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            autoCapitalize="none"
                            autoComplete="email"
                            required
                        />
                        <input
                            className="rounded-xl border border-accent-1 bg-primary-background px-4 py-3 text-sm text-foreground outline-none focus:border-accent-2"
                            placeholder="Password"
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            autoComplete="new-password"
                            required
                        />
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="mt-2 rounded-xl bg-accent-3 px-4 py-3 text-sm font-semibold text-primary-background transition hover:brightness-110 disabled:opacity-60"
                        >
                            {isSubmitting ? "Creating account..." : "Sign up"}
                        </button>
                    </form>
                )}

                <button
                    type="button"
                    onClick={() => {
                        setMode((previousMode) => (previousMode === "login" ? "signup" : "login"));
                        setStatusMessage("");
                    }}
                    className="mt-4 text-sm text-accent-2 underline underline-offset-4 hover:text-foreground"
                >
                    {mode === "login" ? "Need an account? Sign up" : "Have an account? Log in"}
                </button>

                {statusMessage ? <p className="mt-4 text-sm text-accent-2">{statusMessage}</p> : null}
            </section>
        </main>
    )
}
