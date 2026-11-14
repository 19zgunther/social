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
import { reportClientError } from "@/app/lib/errorReport";
import { DEFAULT_THEME, persistAndApplyTheme } from "@/app/lib/theme";
import TetrisBackdrop from "@/app/components/games/tetris/TetrisBackdrop";
import { Button, TextField } from "@/app/ui-components";


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
                const message = await readApiError(response);
                if (response.status >= 500) {
                    reportClientError(
                        "login_client",
                        new Error(`login HTTP ${response.status}: ${message}`),
                        { httpStatus: response.status, identifier },
                    );
                }
                setStatusMessage(message);
                return;
            }

            const payload = (await response.json()) as LoginResponse;
            persistAndApplyTheme(payload.user.theme_info ?? DEFAULT_THEME);
            setAuthUser(payload.user);
            setStatusMessage("");
        } catch (error) {
            reportClientError("login_client", error, { identifier });
            setStatusMessage(error instanceof Error ? error.message : "Failed to log in.");
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
                const message = await readApiError(response);
                if (response.status >= 500) {
                    reportClientError(
                        "signup_client",
                        new Error(`signup HTTP ${response.status}: ${message}`),
                        { httpStatus: response.status, user_name: username, identifier: email },
                    );
                }
                setStatusMessage(message);
                return;
            }

            const payload = (await response.json()) as SignupResponse;
            persistAndApplyTheme(payload.user.theme_info ?? DEFAULT_THEME);
            setAuthUser(payload.user);
            setStatusMessage("");
        } catch (error) {
            reportClientError("signup_client", error, {
                user_name: username,
                identifier: email,
            });
            setStatusMessage(error instanceof Error ? error.message : "Failed to sign up.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const [pageTitleClicked, setPageTitleClicked] = useState(false);
    const [tempInputFocused, setTempInputFocused] = useState(false);
    const handleInputFocus = () => {
        setTempInputFocused(true);
        setTimeout(() => { setTempInputFocused(false); }, 10000);
    }
    const handlePageTitleClick = () => {
        setPageTitleClicked(true);
        setTimeout(() => { setPageTitleClicked(false); }, 3000);
    }

    const pageTitle = useMemo(() => (mode === "login" ? "Log in" : "Create account"), [mode]);

    return (
        <main style={APP_VIEWPORT_STYLE} className="relative flex w-screen justify-center overflow-hidden bg-bg p-0">
            <TetrisBackdrop opacity={0.55} />
            <section
                style={MOBILE_FRAME_STYLE}
                className="relative z-10 flex h-full flex-col justify-center border border-border bg-surface/85 px-6 shadow-lg shadow-black/20 backdrop-blur-md"
            >
                <h1 className="text-lg font-semibold text-foreground"
                    onClick={handlePageTitleClick}    
                >
                    {pageTitle}
                </h1>
                {pageTitleClicked && (
                    <div className="text-sm text-muted">
                        Hello there! Testing...
                        <TextField type="text" onFocus={handleInputFocus} placeholder="Type something..." className="px-4 py-3" />
                        {tempInputFocused && <p className="text-sm text-muted">Input focused</p>}
                    </div>
                )}
                <p className="mt-1 text-sm text-muted">Single-page auth flow for mobile-first layout.</p>
                {mode === "signup" ? (
                    <p className="mt-3 text-sm text-muted">
                        Sorry ppl are dumb and I hate resetting passwords so enter your emails so we can automate it
                    </p>
                ) : null}

                {mode === "login" ? (
                    <form className="mt-6 flex flex-col gap-3" onSubmit={submitLogin}>
                        <TextField
                            className="px-4 py-3"
                            placeholder="Username or email"
                            value={identifier}
                            onChange={(event) => setIdentifier(event.target.value)}
                            autoCapitalize="none"
                            autoComplete="username"
                            required
                        />
                        <TextField
                            className="px-4 py-3"
                            placeholder="Password"
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            autoComplete="current-password"
                            required
                        />
                        <Button
                            type="submit"
                            variant="primary"
                            size="md"
                            className="mt-2"
                            disabled={isSubmitting || isSendingTempEmail}
                        >
                            {isSubmitting ? "Logging in..." : "Log in"}
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            size="md"
                            onClick={() => void sendTempLoginEmail()}
                            disabled={isSubmitting || isSendingTempEmail}
                        >
                            {isSendingTempEmail ? "Sending…" : "Email me a temporary login code"}
                        </Button>
                    </form>
                ) : (
                    <form className="mt-6 flex flex-col gap-3" onSubmit={submitSignup}>
                        <TextField
                            className="px-4 py-3"
                            placeholder="Username"
                            value={username}
                            onChange={(event) => setUsername(event.target.value)}
                            autoCapitalize="none"
                            autoComplete="username"
                            required
                        />
                        <TextField
                            className="px-4 py-3"
                            placeholder="Email"
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            autoCapitalize="none"
                            autoComplete="email"
                            required
                        />
                        <TextField
                            className="px-4 py-3"
                            placeholder="Password"
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            autoComplete="new-password"
                            required
                        />
                        <Button
                            type="submit"
                            variant="primary"
                            size="md"
                            className="mt-2"
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? "Creating account..." : "Sign up"}
                        </Button>
                    </form>
                )}

                <button
                    type="button"
                    onClick={() => {
                        setMode((previousMode) => (previousMode === "login" ? "signup" : "login"));
                        setStatusMessage("");
                    }}
                    className="mt-4 text-sm text-muted underline underline-offset-4 hover:text-foreground"
                >
                    {mode === "login" ? "Need an account? Sign up" : "Have an account? Log in"}
                </button>

                {statusMessage ? <p className="mt-4 text-sm text-muted">{statusMessage}</p> : null}
            </section>
        </main>
    )
}
