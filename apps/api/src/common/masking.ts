/** Versões parciais de contatos para logs e respostas (nunca o dado completo). */
export function maskPhone(digits: string) {
  return `(${digits.slice(0, 2)}) *****-${digits.slice(-4)}`;
}

export function maskEmail(email: string) {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}
