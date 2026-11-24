"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
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

type KeypadPressSource = "pointer" | "click";

const PIN_KEYS: readonly PinKey[] = [
  ...KEYPAD_DIGITS.map((digit): PinKey => ({ kind: "digit", digit })),
  { kind: "clear" },
  { kind: "digit", digit: "0" },
  { kind: "backspace" },
];

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
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

function isMobileImeKey(event: { key: string; keyCode: number }): boolean {
  return event.key === "Unidentified" || event.keyCode === 229;
}

function inputTypeOf(event: FormEvent<HTMLInputElement>): string {
  const native = event.nativeEvent;
  if (typeof InputEvent !== "undefined" && native instanceof InputEvent) {
    return native.inputType;
  }
  return "";
}

/**
 * Mobile-first 6-digit PIN pad.
 * The player submits explicitly. A rejected `onComplete` shows the error
 * and clears the entry so they can try again.
 *
 * iOS Safari drops the synthetic click when `preventDefault()` runs on
 * touch or pointer events, so the keypad commits on `pointerup` and `click`
 * with neither event cancelled. Digit boxes stay controlled, and a frame
 * loop copies digits that WebKit wrote into the DOM without an `input` event.
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
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const keypadPressAtRef = useRef(0);
  const deleteLockRef = useRef(false);
  const insertDigitsRef = useRef<(index: number, raw: string, moveFocus: boolean) => void>(
    () => {},
  );

  pinRef.current = pin;

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const focusDigit = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(index, PIN_LENGTH - 1));
    const input = inputRefs.current[clamped];
    if (!input) {
      return;
    }
    input.focus();
    const pos = input.value.length;
    try {
      input.setSelectionRange(pos, pos);
    } catch {
      // Some mobile browsers reject a caret on type="tel".
    }
  }, []);

  const commitPin = useCallback(
    (next: string, focusIndex: number | null) => {
      if (submittingRef.current) {
        return;
      }
      const clean = digitsOnly(next).slice(0, PIN_LENGTH);
      if (clean !== pinRef.current) {
        pinRef.current = clean;
        setPin(clean);
        setErrorMessage(null);
        setStatus((current) => (current === "error" ? "idle" : current));
      }
      if (focusIndex !== null) {
        const target = Math.max(0, Math.min(focusIndex, PIN_LENGTH - 1));
        requestAnimationFrame(() => {
          focusDigit(target);
        });
      }
    },
    [focusDigit],
  );

  const insertDigits = useCallback(
    (index: number, raw: string, moveFocus: boolean) => {
      const extracted = digitsOnly(raw);
      if (extracted.length === 0 || submittingRef.current) {
        return;
      }

      const current = pinRef.current;
      if (
        extracted.length === 1 &&
        index < current.length &&
        current[index] === extracted
      ) {
        return;
      }

      let next: string;
      let focusAt: number;
      if (extracted.length === 1 && index === current.length) {
        next = current + extracted;
        focusAt = next.length;
      } else if (extracted.length === 1 && index < current.length) {
        next = current.slice(0, index) + extracted + current.slice(index + 1);
        focusAt = index + 1;
      } else {
        const start = Math.min(index, current.length);
        next = (
          current.slice(0, start) +
          extracted +
          current.slice(start + extracted.length)
        ).slice(0, PIN_LENGTH);
        focusAt = start + extracted.length;
      }

      next = next.slice(0, PIN_LENGTH);
      if (next === current) {
        return;
      }
      commitPin(next, moveFocus ? Math.min(focusAt, PIN_LENGTH - 1) : null);
    },
    [commitPin],
  );

  const removeAt = useCallback(
    (index: number) => {
      if (submittingRef.current || deleteLockRef.current) {
        return;
      }
      deleteLockRef.current = true;
      queueMicrotask(() => {
        deleteLockRef.current = false;
      });
      const current = pinRef.current;
      if (current.length === 0) {
        return;
      }
      if (index < current.length) {
        commitPin(current.slice(0, index) + current.slice(index + 1), index);
        return;
      }
      commitPin(current.slice(0, -1), Math.max(0, current.length - 2));
    },
    [commitPin],
  );

  const appendDigit = useCallback(
    (digit: string) => {
      if (submittingRef.current || !/^[0-9]$/.test(digit)) {
        return;
      }
      if (pinRef.current.length >= PIN_LENGTH) {
        return;
      }
      commitPin(pinRef.current + digit, null);
    },
    [commitPin],
  );

  const removeDigit = useCallback(() => {
    if (submittingRef.current || pinRef.current.length === 0) {
      return;
    }
    commitPin(pinRef.current.slice(0, -1), null);
  }, [commitPin]);

  const clearPin = useCallback(() => {
    if (submittingRef.current || pinRef.current.length === 0) {
      return;
    }
    commitPin("", null);
  }, [commitPin]);

  const pressKey = useCallback(
    (key: string, source: KeypadPressSource) => {
      const now = performance.now();
      if (source === "click" && now - keypadPressAtRef.current < 700) {
        return;
      }
      if (source === "pointer") {
        keypadPressAtRef.current = now;
      }
      if (key === "clear") {
        clearPin();
        return;
      }
      if (key === "backspace") {
        removeDigit();
        return;
      }
      appendDigit(key);
    },
    [appendDigit, clearPin, removeDigit],
  );

  useEffect(() => {
    insertDigitsRef.current = insertDigits;
  });

  const submitPin = useCallback((value: string) => {
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
        pinRef.current = "";
        setPin("");
        setErrorMessage(messageFromUnknown(error));
        setStatus("error");
        requestAnimationFrame(() => {
          focusDigit(0);
        });
      });
  }, [focusDigit]);

  const requestSubmit = useCallback(() => {
    submitPin(pinRef.current);
  }, [submitPin]);

  useEffect(() => {
    let frame = 0;
    const pullDomDigits = () => {
      inputRefs.current.forEach((input, index) => {
        if (!input) {
          return;
        }
        const digits = digitsOnly(input.value);
        const stateDigit = pinRef.current[index] ?? "";
        if (digits.length > 0 && digits !== stateDigit) {
          insertDigitsRef.current(index, input.value, false);
        }
      });
      frame = requestAnimationFrame(pullDomDigits);
    };
    frame = requestAnimationFrame(pullDomDigits);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, []);

  const handleFieldInput = useCallback(
    (index: number, event: FormEvent<HTMLInputElement>) => {
      const inputType = inputTypeOf(event);
      if (inputType.startsWith("delete")) {
        removeAt(index);
        return;
      }
      const digits = digitsOnly(event.currentTarget.value);
      if (digits.length === 0) {
        event.currentTarget.value = pinRef.current[index] ?? "";
        return;
      }
      insertDigits(index, event.currentTarget.value, true);
    },
    [insertDigits, removeAt],
  );

  const handlePaste = useCallback(
    (index: number, event: ClipboardEvent<HTMLInputElement>) => {
      const incoming = digitsOnly(event.clipboardData.getData("text"));
      if (incoming.length === 0) {
        return;
      }
      event.preventDefault();
      insertDigits(index, incoming, true);
    },
    [insertDigits],
  );

  const handleCompositionEnd = useCallback(
    (index: number, event: CompositionEvent<HTMLInputElement>) => {
      const digits = digitsOnly(event.currentTarget.value);
      if (digits.length === 0) {
        return;
      }
      insertDigits(index, event.currentTarget.value, true);
    },
    [insertDigits],
  );

  const handleDigitKeyDown = useCallback(
    (index: number, event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (isMobileImeKey(event)) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        removeAt(index);
        return;
      }

      if (event.key === "Escape" || event.key === "Delete") {
        event.preventDefault();
        clearPin();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (index > 0) {
          focusDigit(index - 1);
        }
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (index < PIN_LENGTH - 1) {
          focusDigit(index + 1);
        }
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        requestSubmit();
      }
    },
    [clearPin, focusDigit, removeAt, requestSubmit],
  );

  const handleFormSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      requestSubmit();
    },
    [requestSubmit],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isMobileImeKey(event)) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target;
      if (inputRefs.current.some((input) => input === target)) {
        return;
      }

      const isOtherField =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (isOtherField) {
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
      noValidate
      className="mx-auto flex w-full max-w-sm flex-col items-center gap-5 px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      onSubmit={handleFormSubmit}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">
          Wpisz PIN
        </h2>
        <p className="text-sm text-zinc-400">Sześć cyfr, aby się zalogować.</p>
      </div>

      <div
        className="flex gap-2.5"
        role="group"
        aria-label={`Wpisano ${pin.length} z ${PIN_LENGTH} cyfr PIN`}
      >
        {Array.from({ length: PIN_LENGTH }, (_, index) => {
          const digit = pin[index] ?? "";
          const filled = digit !== "";
          return (
            <div key={index} className="relative h-14 w-11 shrink-0">
              <input
                ref={(node) => {
                  inputRefs.current[index] = node;
                }}
                type="tel"
                name={index === 0 ? "pin" : `pin-${index}`}
                value={digit}
                inputMode="numeric"
                autoComplete={index === 0 ? "one-time-code" : "off"}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="done"
                pattern="[0-9]*"
                aria-label={`Cyfra ${index + 1} z ${PIN_LENGTH}`}
                aria-invalid={status === "error"}
                disabled={isSubmitting}
                onInput={(event) => {
                  handleFieldInput(index, event);
                }}
                onKeyUp={(event) => {
                  if (!isMobileImeKey(event)) {
                    return;
                  }
                  if (digitsOnly(event.currentTarget.value).length === 0) {
                    return;
                  }
                  insertDigits(index, event.currentTarget.value, true);
                }}
                onPaste={(event) => {
                  handlePaste(index, event);
                }}
                onCompositionEnd={(event) => {
                  handleCompositionEnd(index, event);
                }}
                onKeyDown={(event) => {
                  handleDigitKeyDown(index, event);
                }}
                className={`h-14 w-11 touch-manipulation rounded-2xl border-2 bg-white text-center text-base text-transparent caret-zinc-900 select-text outline-none dark:bg-zinc-950 dark:caret-zinc-100 ${
                  filled && status !== "error"
                    ? "border-zinc-900 dark:border-zinc-100"
                    : indicatorTone
                } ${isSubmitting ? "animate-pulse" : ""}`}
                style={{
                  fontSize: 16,
                  userSelect: "text",
                  WebkitUserSelect: "text",
                }}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex items-center justify-center"
              >
                <span
                  className={`size-3 rounded-full ${
                    filled
                      ? status === "error"
                        ? "bg-red-500 dark:bg-red-400"
                        : "bg-zinc-900 dark:bg-zinc-100"
                      : "bg-transparent"
                  }`}
                />
              </span>
            </div>
          );
        })}
      </div>

      <div
        className="flex min-h-10 w-full items-center justify-center"
        aria-live="polite"
      >
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
          <p
            role="alert"
            className="text-center text-sm font-medium text-red-600 dark:text-red-400"
          >
            {errorMessage}
          </p>
        ) : null}
      </div>

      <div
        className="grid w-full grid-cols-3 gap-2.5 sm:gap-3"
        role="group"
        aria-label="Klawiatura PIN"
        aria-busy={isSubmitting}
      >
        {PIN_KEYS.map((key) => {
          if (key.kind === "digit") {
            return (
              <KeyButton
                key={key.digit}
                pinKey={key.digit}
                label={key.digit}
                disabled={isSubmitting}
                onPress={pressKey}
              />
            );
          }

          if (key.kind === "clear") {
            return (
              <KeyButton
                key="clear"
                pinKey="clear"
                label="Wyczyść"
                ariaLabel="Wyczyść PIN"
                disabled={isSubmitting || pin.length === 0}
                variant="muted"
                onPress={pressKey}
              />
            );
          }

          return (
            <KeyButton
              key="backspace"
              pinKey="backspace"
              label={<BackspaceIcon />}
              ariaLabel="Usuń ostatnią cyfrę"
              disabled={isSubmitting || pin.length === 0}
              variant="muted"
              onPress={pressKey}
            />
          );
        })}
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="flex h-14 w-full shrink-0 items-center justify-center rounded-2xl bg-white text-base font-semibold text-zinc-950 shadow-sm transition touch-manipulation active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        Zatwierdź ✅
      </button>
    </form>
  );
}

export default PinEntry;

interface KeyButtonProps {
  pinKey: string;
  label: ReactNode;
  ariaLabel?: string;
  disabled: boolean;
  variant?: "digit" | "muted";
  onPress: (key: string, source: KeypadPressSource) => void;
}

function KeyButton({
  pinKey,
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

  const press = (source: KeypadPressSource) => {
    if (!disabled) {
      onPress(pinKey, source);
    }
  };

  return (
    <button
      type="button"
      data-pin-key={pinKey}
      aria-label={ariaLabel}
      disabled={disabled}
      onPointerUp={(event: ReactPointerEvent<HTMLButtonElement>) => {
        if (event.pointerType === "mouse" && event.button !== 0) {
          return;
        }
        press("pointer");
      }}
      onClick={() => {
        press("click");
      }}
      className={`flex h-14 min-h-11 w-full items-center justify-center rounded-2xl shadow-sm transition touch-manipulation select-none active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 sm:h-16 ${tone} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100`}
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
