export function requireStripeTestMode(secretKey: string): void {
  if (!secretKey.startsWith('sk_test_')) {
    throw new Error(
      'STATUS payment integration requires a Stripe test-mode secret key'
    );
  }

  if (process.env.STATUS_STRIPE_LIVE_ENABLED === 'true') {
    throw new Error(
      'Stripe live payments are not authorized in this build'
    );
  }
}
