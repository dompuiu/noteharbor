function addThousandsSeparators(integerPart) {
  return integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function normalizeDenomination(value) {
  const trimmed = String(value ?? '').trim();
  const match = trimmed.match(/^(\d[\d,]*)(\.\d+)?(.*)$/);

  if (!match) {
    return trimmed;
  }

  const [, rawIntegerPart, decimalPart = '', suffix = ''] = match;
  const integerDigits = rawIntegerPart.replace(/,/g, '');

  if (!/^\d+$/.test(integerDigits)) {
    return trimmed;
  }

  return `${addThousandsSeparators(integerDigits)}${decimalPart}${suffix}`;
}

export { normalizeDenomination };
