const customers = {
  blr: { city: 'bengaluru', provider: 'a' },
  mum: { city: 'mumbai', provider: 'b' },
  del: { city: 'delhi', provider: 'c' },
} as const;

export function customerRoute(customerId: unknown) {
  if (typeof customerId !== 'string') return;
  const match = /^cust-(blr|mum|del)-(\d{4})$/.exec(customerId);
  if (!match || match[0] !== customerId) return;
  const number = Number(match[2]);
  if (number < 1 || number > 500) return;
  return customers[match[1] as keyof typeof customers];
}

export function deliveryOptions(enabled: boolean) {
  return enabled ? ['delivery', 'pickup'] : ['pickup'];
}
