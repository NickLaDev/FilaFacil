-- Contas sem senha (celular/Google/Apple) confirmam um código antes de cadastrar biometria.
ALTER TYPE "otp_purpose" ADD VALUE 'passkey_registration';
