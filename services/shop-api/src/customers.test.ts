import { expect, test } from 'bun:test';
import { customerRoute, deliveryOptions } from './customers.ts';

test('customer IDs map to their city and provider, including probe IDs', () => {
  expect(customerRoute('cust-blr-0001')).toEqual({ city: 'bengaluru', provider: 'a' });
  expect(customerRoute('cust-mum-0142')).toEqual({ city: 'mumbai', provider: 'b' });
  expect(customerRoute('cust-del-0500')).toEqual({ city: 'delhi', provider: 'c' });
});

test('customer IDs require a known prefix and a four-digit number in range', () => {
  for (const id of ['cust-abc-0001', 'cust-mum-1', 'cust-blr-0000', 'cust-del-0501',
    'cust-blr-0001\n', ['cust-blr-0001'], undefined]) {
    expect(customerRoute(id)).toBeUndefined();
  }
});

test('pickup is always offered and delivery follows the flag', () => {
  expect(deliveryOptions(true)).toEqual(['delivery', 'pickup']);
  expect(deliveryOptions(false)).toEqual(['pickup']);
});
