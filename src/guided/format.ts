export const format = (n: number, digits = 4) => n.toLocaleString('pt-BR', {minimumFractionDigits: digits, maximumFractionDigits: digits})
export const piece = (text: string) => text.replaceAll('▁', '␣')
