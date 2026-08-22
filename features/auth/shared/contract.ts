export type User = {
  email: string | null;
  name: string | null;
};

export type AuthSessionResponse = {
  user: User | null;
};

export type AuthSuccessResponse = {
  ok: true;
};

export type AuthErrorCode =
  | "SERVER_CONFIG_ERROR"
  | "INVALID_ORIGIN"
  | "MISSING_TOKEN"
  | "INVALID_TOKEN";

export type AuthError = {
  error: {
    code: AuthErrorCode;
    message: string;
  };
};
