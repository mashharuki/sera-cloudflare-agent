---
name: privy
description: Use when building wallet infrastructure, authentication systems, or financial applications. Reach for Privy when you need to create embedded wallets, authenticate users, manage wallet controls and policies, execute transactions, or build financial flows like deposits, payouts, and swaps.
metadata:
    mintlify-proj: privy
    version: "1.0"
---

# Privy Skill Reference

## Product summary

Privy is a programmable wallet infrastructure platform for building financial applications. It provides embedded wallets (created and managed by Privy), authentication systems (email, social, passkeys, wallets), and financial flows (deposits, payouts, swaps, yield). Use Privy's client-side SDKs (React, React Native, Swift, Android, Flutter, Unity) to build user-facing applications, and server-side SDKs (Node.js, Java, Go, Rust, Ruby, Python) or REST API to manage wallets, users, and policies from your backend.

**Key files and entry points:**
- Dashboard: https://dashboard.privy.io (configure apps, login methods, integrations)
- Client SDKs: `@privy-io/react-auth`, `@privy-io/react-native`, `@privy-io/swift`, etc.
- Server SDKs: `@privy-io/node`, `@privy-io/java`, `@privy-io/go`, etc.
- REST API: POST/GET endpoints for users, wallets, policies, transactions
- Webhooks: Subscribe to user, wallet, transaction, and action events

**Primary docs:** https://docs.privy.io

## When to use

**Authentication and user management:**
- User login with email, SMS, social (Google, Discord, Twitter, etc.), passkeys, or external wallets
- Multi-factor authentication (MFA) with passkeys or TOTP
- User creation and migration from existing systems
- Account linking and unlinking

**Wallet creation and management:**
- Create embedded wallets for users, organizations, or servers
- Support multiple chains (Ethereum, Solana, Bitcoin, Tempo, Tron, etc.)
- Import existing wallets or HD wallets
- Export private keys for self-custody
- Connect external wallets (MetaMask, Phantom, etc.)

**Transaction execution:**
- Send transactions on Ethereum, Solana, and other chains
- Sign messages and typed data
- Execute swaps, transfers, and DeFi actions
- Batch transactions and use intents for async approval workflows

**Controls and policies:**
- Define who can sign transactions (owners, signers, quorums)
- Create policies to restrict transaction amounts, recipients, contract interactions
- Set up multi-sig wallets and approval workflows
- Implement role-based access control

**Financial flows:**
- Fiat deposits (bank transfers, card onramps)
- Crypto deposits (receive and convert)
- Fiat payouts (crypto to bank account)
- Crypto transfers with bridging and conversion
- Yield integrations (Aave, Morpho, etc.)
- Swaps and token exchanges

**Monitoring and webhooks:**
- Subscribe to user, wallet, transaction, and action events
- Track transaction lifecycle (created, confirmed, failed)
- Monitor balance changes and deposits/withdrawals
- React to intent approvals and rejections

## Quick reference

### SDK initialization

**React:**
```tsx
import {PrivyProvider} from '@privy-io/react-auth';

<PrivyProvider appId="your-app-id" clientId="your-client-id" config={{...}}>
  {children}
</PrivyProvider>
```

**Node.js:**
```ts
import {PrivyClient} from '@privy-io/node';
const privy = new PrivyClient({appId: 'app-id', appSecret: 'app-secret'});
```

### Common operations

| Task | Client SDK | Server SDK |
|------|-----------|-----------|
| Authenticate user | `usePrivy().login()` | N/A (verify token) |
| Create wallet | `useCreateWallet()` | `privy.wallets().create()` |
| Send transaction | `useSendTransaction()` | `privy.wallets().ethereum().sendTransaction()` |
| Sign message | `useSignMessage()` | `privy.wallets().ethereum().personalSign()` |
| Get user | `usePrivy().user` | `privy.users().get(userId)` |
| Create policy | Dashboard or API | `privy.policies().create()` |
| Subscribe to events | N/A | Configure webhooks in dashboard |

### Configuration locations

- **Login methods:** Dashboard > Configuration > Authentication
- **Wallet chains:** Dashboard > Configuration > Wallets
- **Integrations:** Dashboard > Configuration > Integrations (Bridge, Stripe, etc.)
- **Webhooks:** Dashboard > Configuration > Webhooks
- **UI customization:** Dashboard > Configuration > UI components
- **App clients:** Dashboard > Configuration > App clients (for multi-environment setup)

### Chain support

Ethereum, Solana, Bitcoin (Segwit, Taproot), Tempo, Tron, Sui, Aptos, Cosmos, Stellar, and 40+ others. Configure supported chains per app in dashboard.

## Decision guidance

| Scenario | Use embedded wallets | Use external wallets |
|----------|-------------------|-------------------|
| New users, consumer app | ✓ Auto-create on login | Connect if they have one |
| Crypto-native users | Optional | ✓ Preferred for power users |
| Non-custodial requirement | ✓ User owns keys | ✓ User owns keys |
| Server-controlled wallets | ✓ Authorization keys | N/A |
| Institutional/treasury | ✓ Custodial option | N/A |

| Scenario | Use Privy auth | Use JWT-based auth |
|----------|---------------|-------------------|
| No existing auth system | ✓ Full-featured | N/A |
| Existing auth provider | Optional | ✓ Integrate with Privy wallets |
| Delegated login (OAuth, email) | ✓ Supported | ✓ Supported |
| Direct auth (passkeys) | ✓ Recommended | ✓ Supported |

| Scenario | Use wallet actions API | Use RPC/intents |
|----------|----------------------|-----------------|
| Simple transfers, swaps | ✓ High-level, handles complexity | N/A |
| Custom transaction flows | N/A | ✓ Low-level control |
| Async approval workflows | N/A | ✓ Intents support async |
| DeFi interactions | ✓ Earn, swap, transfer | ✓ For custom contracts |

## Workflow

### 1. Set up your app
- Create app in Privy Dashboard and obtain app ID and app secret
- Configure login methods (email, socials, passkeys, wallets)
- Enable wallet chains (Ethereum, Solana, etc.)
- Set up integrations (Bridge for deposits/payouts, Stripe for cards)
- Configure webhooks for event monitoring

### 2. Implement authentication
- Wrap client app with `PrivyProvider` (React) or initialize SDK (mobile)
- Call `login()` to authenticate users
- Check `usePrivy().ready` before consuming state
- Verify access tokens on server with `privy.users().verifyToken()`

### 3. Create and manage wallets
- Auto-create wallets on login with `createOnLogin: 'users-without-wallets'`
- Or manually create with `useCreateWallet()` (client) or `privy.wallets().create()` (server)
- Retrieve wallet with `useWallets()` (client) or `privy.wallets().get()` (server)
- Configure owners, signers, and policies for access control

### 4. Execute transactions
- Use wallet action APIs for common flows: `useSendTransaction()`, `useSwap()`, `useEarn()`
- Or use RPC for custom flows: `useSignTransaction()`, `useSignMessage()`
- For async approval: create intent, collect signatures, execute
- Track status via webhooks or polling

### 5. Monitor and react
- Subscribe to webhooks: user events, wallet events, transaction events, action events
- Verify webhook signatures with your app secret
- React to state changes: user.authenticated, wallet.funds_deposited, transaction.confirmed
- Use external IDs to correlate requests with your system

## Common gotchas

- **HTTPS required:** Embedded wallets only work in secure contexts (https://). Localhost is treated as secure by browsers.
- **Wait for ready:** Always check `usePrivy().ready` before consuming state; Privy initializes asynchronously.
- **Policy evaluation:** Policies are evaluated at request time in secure enclaves; they're not enforced client-side.
- **Rate limits:** Server SDK calls are rate-limited; implement exponential backoff and batch operations.
- **Delegated auth security:** If using OAuth/email as primary auth, require MFA (passkey or TOTP) to protect wallet access.
- **Webhook retries:** Privy retries failed webhooks; implement idempotency to handle duplicates.
- **Token expiry:** Access tokens expire; refresh them or re-authenticate before they expire.
- **Chain configuration:** Wallets must be configured for the chains you want to support; custom chains require manual setup.
- **External wallet limitations:** External wallets don't support all Privy features (e.g., policies, offline actions); check compatibility.
- **Custody model:** Custodial wallets require licensed custody partners; not all chains/features are supported.

## Verification checklist

Before submitting work with Privy:

- [ ] App ID and app secret are configured in environment variables (never hardcoded)
- [ ] `PrivyProvider` wraps the app and `ready` is checked before consuming state
- [ ] Login methods are configured in dashboard and match your app's requirements
- [ ] Wallet chains are enabled for all chains your app uses
- [ ] Policies are created and attached to wallets if access control is needed
- [ ] Webhooks are configured and endpoint is verified (signature check implemented)
- [ ] Error handling covers NotFoundError, rate limits (429), and auth failures
- [ ] Transactions are tested on testnet before production
- [ ] MFA is enabled if using delegated auth (OAuth, email, SMS)
- [ ] External IDs are set on wallets/users for correlation with your system
- [ ] Rate limit handling (exponential backoff) is implemented for server SDK calls
- [ ] Idempotency keys are used for critical operations (wallet creation, transfers)

## Resources

**Comprehensive navigation:** https://docs.privy.io/llms.txt

**Critical pages:**
- [Key concepts](https://docs.privy.io/basics/key-concepts) — Understand authentication, wallets, and controls
- [React SDK setup](https://docs.privy.io/basics/react/setup) — Initialize PrivyProvider and configure
- [Wallet creation](https://docs.privy.io/wallets/wallets/create/create-a-wallet) — Create embedded wallets programmatically
- [Policies overview](https://docs.privy.io/controls/policies/overview) — Define wallet access rules
- [REST API introduction](https://docs.privy.io/api-reference/introduction) — Server-side wallet and user management
- [Webhooks overview](https://docs.privy.io/api-reference/webhooks/overview) — Subscribe to events

---

> For additional documentation and navigation, see: https://docs.privy.io/llms.txt