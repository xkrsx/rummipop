"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

const PIN_LENGTH = 6;

const KEYPAD_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export interface PinEntryProps {
  onComplete: (pin: string) => Promise<void>;
}

type EntryStatus = "idle" | "submitting" | "error";

type PinKey =
  | { readonly kind: "digit"; readonly digit: string }
  | { readonly kind: "clear" }
  | { readonly kind: "backspace" };

const PIN_KEYS: readonly PinKey[] = [
  ...KEYPAD_DIGITS.map((digit): PinKey => ({ kind: "digit", digit })),
  { kind: "clear" },
  { kind: "digit", digit: "0" },
  { kind: "backspace" },
];

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "").slice(0, PIN_LENGTH);
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "Nie rozpoznano tego PIN-u. Spróbuj ponownie.";
}

/**
 * Mobile-first 6-digit PIN pad.
 * The player submits explicitly. A rejected `onComplete` shows the error
 * and clears the entry so they can try again.
 */
export function PinEntry({ onComplete }: PinEntryProps) {
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState<EntryStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pinRef = useRef("");
  const submittingRef = useRef(false);
  const requestIdRef = useRef(0);
  const aliveRef = useRef(true);
  const onCompleteRef = useRef(onComplete);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const syncPin = useCallback((next: string) => {
    pinRef.current = next;
    setPin(next);
  }, []);

  const submitPin = useCallback(
    (value: string) => {
      if (submittingRef.current || value.length !== PIN_LENGTH) {
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      submittingRef.current = true;
      setStatus("submitting");
      setErrorMessage(null);

      void onCompleteRef
        .current(value)
        .then(() => {
          if (!aliveRef.current || requestIdRef.current !== requestId) {
            return;
          }
          submittingRef.current = false;
          setStatus("idle");
        })
        .catch((error: unknown) => {
          if (!aliveRef.current || requestIdRef.current !== requestId) {
            return;
          }
          submittingRef.current = false;
          syncPin("");
          setErrorMessage(messageFromUnknown(error));
          setStatus("error");
        });
    },
    [syncPin],
  );

  const requestSubmit = useCallback(() => {
    submitPin(pinRef.current);
  }, [submitPin]);

  const appendDigit = useCallback(
    (digit: string) => {
      if (submittingRef.current || !/^[0-9]$/.test(digit)) {
        return;
      }
      if (pinRef.current.length >= PIN_LENGTH) {
        return;
      }

      syncPin(pinRef.current + digit);
      setErrorMessage(null);
      setStatus("idle");
    },
    [syncPin],
  );

  const removeDigit = useCallback(() => {
    if (submittingRef.current || pinRef.current.length === 0) {
      return;
    }
    syncPin(pinRef.current.slice(0, -1));
    setErrorMessage(null);
    setStatus("idle");
  }, [syncPin]);

  const clearPin = useCallback(() => {
    if (submittingRef.current) {
      return;
    }
    syncPin("");
    setErrorMessage(null);
    setStatus("idle");
  }, [syncPin]);

  const applyInputValue = useCallback(
    (raw: string) => {
      if (submittingRef.current) {
        return;
      }

      const next = digitsOnly(raw);
      const input = inputRef.current;
      if (input && input.value !== next) {
        input.value = next;
      }

      if (next === pinRef.current) {
        return;
      }

      syncPin(next);
      setErrorMessage(null);
      setStatus("idle");
    },
    [syncPin],
  );

  const focusPinInput = useCallback(() => {
    if (submittingRef.current) {
      return;
    }
    inputRef.current?.focus();
  }, []);

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      applyInputValue(event.target.value);
    },
    [applyInputValue],
  );

  const handleFormSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      requestSubmit();
    },
    [requestSubmit],
  );

  useEffect(() => {
    const input = inputRef.current;
    if (!input || document.activeElement !== input) {
      return;
    }
    const end = pin.length;
    input.setSelectionRange(end, end);
  }, [pin]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target;
      const isPinInput = target === inputRef.current;
      const isOtherField =
        !isPinInput &&
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (isOtherField) {
        return;
      }

      if (isPinInput) {
        if (event.key === "Enter") {
          event.preventDefault();
          requestSubmit();
        } else if (event.key === "Escape" || event.key === "Delete") {
          event.preventDefault();
          clearPin();
        }
        return;
      }

      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        appendDigit(event.key);
        return;
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        removeDigit();
        return;
      }

      if (event.key === "Escape" || event.key === "Delete") {
        event.preventDefault();
        clearPin();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        requestSubmit();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [appendDigit, clearPin, removeDigit, requestSubmit]);

  const isSubmitting = status === "submitting";
  const canSubmit = pin.length === PIN_LENGTH && !isSubmitting;
  const indicatorTone =
    status === "error"
      ? "border-red-500 dark:border-red-400"
      : "border-zinc-300 dark:border-zinc-600";

  return (
    <form
      className="mx-auto flex w-full max-w-sm flex-col items-center gap-8 px-4 py-6 select-none"
      onSubmit={handleFormSubmit}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">
          Wpisz PIN
        </h2>
        <p className="text-sm text-zinc-400">
          Sześć cyfr, aby się zalogować.
        </p>
      </div>

      <div
        className="relative flex gap-2.5"
        role="group"
        aria-label={`Wpisano ${pin.length} z ${PIN_LENGTH} cyfr PIN`}
        onClick={focusPinInput}
      >
        <input
          ref={inputRef}
          type="text"
          name="pin"
          value={pin}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="done"
          pattern="[0-9]*"
          maxLength={PIN_LENGTH}
          aria-label="PIN"
          aria-invalid={status === "error"}
          disabled={isSubmitting}
          onChange={handleInputChange}
          onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") {
              event.preventDefault();
              requestSubmit();
            }
          }}
          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
          style={{ fontSize: 16 }}
        />
        {Array.from({ length: PIN_LENGTH }, (_, index) => {
          const filled = index < pin.length;
          return (
            <span
              key={index}
              aria-hidden="true"
              className={`pointer-events-none flex h-14 w-11 items-center justify-center rounded-2xl border-2 bg-white transition-colors dark:bg-zinc-950 ${
                filled && status !== "error"
                  ? "border-zinc-900 dark:border-zinc-100"
                  : indicatorTone
              } ${isSubmitting ? "animate-pulse" : ""}`}
            >
              <span
                className={`size-3 rounded-full transition-colors ${
                  filled
                    ? status === "error"
                      ? "bg-red-500 dark:bg-red-400"
                      : "bg-zinc-900 dark:bg-zinc-100"
                    : "bg-transparent"
                }`}
              />
            </span>
          );
        })}
      </div>

      <div className="flex min-h-12 w-full items-center justify-center" aria-live="polite">
        {isSubmitting ? (
          <p className="flex items-center gap-2 text-sm font-medium text-zinc-300">
            <span
              className="size-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-600 dark:border-t-zinc-100"
              aria-hidden="true"
            />
            Sprawdzanie PIN-u
          </p>
        ) : null}
        {status === "error" && errorMessage !== null ? (
          <p role="alert" className="text-center text-sm font-medium text-red-600 dark:text-red-400">
            {errorMessage}
          </p>
        ) : null}
      </div>

      <div
        className="grid w-full grid-cols-3 gap-3"
        role="group"
        aria-label="Klawiatura PIN"
        aria-busy={isSubmitting}
      >
        {PIN_KEYS.map((key) => {
          if (key.kind === "digit") {
            return (
              <KeyButton
                key={key.digit}
                label={key.digit}
                disabled={isSubmitting}
                onPress={() => {
                  appendDigit(key.digit);
                }}
              />
            );
          }

          if (key.kind === "clear") {
            return (
              <KeyButton
                key="clear"
                label="Wyczyść"
                ariaLabel="Wyczyść PIN"
                disabled={isSubmitting || pin.length === 0}
                variant="muted"
                onPress={clearPin}
              />
            );
          }

          return (
            <KeyButton
              key="backspace"
              label={<BackspaceIcon />}
              ariaLabel="Usuń ostatnią cyfrę"
              disabled={isSubmitting || pin.length === 0}
              variant="muted"
              onPress={removeDigit}
            />
          );
        })}
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="flex h-14 w-full items-center justify-center rounded-2xl bg-white text-base font-semibold text-zinc-950 shadow-sm transition touch-manipulation active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        Zatwierdź ✅
      </button>
    </form>
  );
}

export default PinEntry;

interface KeyButtonProps {
  label: ReactNode;
  ariaLabel?: string;
  disabled: boolean;
  variant?: "digit" | "muted";
  onPress: () => void;
}

function KeyButton({
  label,
  ariaLabel,
  disabled,
  variant = "digit",
  onPress,
}: KeyButtonProps) {
  const tone =
    variant === "muted"
      ? "bg-zinc-200 text-base font-semibold text-zinc-700 active:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:active:bg-zinc-700"
      : "bg-zinc-100 text-3xl font-semibold text-zinc-900 active:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-50 dark:active:bg-zinc-800";

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onPress}
      className={`flex h-16 items-center justify-center rounded-2xl shadow-sm transition touch-manipulation active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 sm:h-20 ${tone} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100`}
    >
      {label}
    </button>
  );
}

function BackspaceIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-7"
      aria-hidden="true"
    >
      <path d="M21 5H9.5a2 2 0 0 0-1.6.8L3 12l4.9 6.2a2 2 0 0 0 1.6.8H21a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z" />
      <path d="m14 9 5 6" />
      <path d="m19 9-5 6" />
    </svg>
  );
}
