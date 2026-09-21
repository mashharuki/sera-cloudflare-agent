import {
  PrivyProvider,
  usePrivy,
  type WalletWithMetadata,
} from "@privy-io/react-auth";
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";

import "./privy-spike.css";

const preflightSchema = z.object({
  amountWei: z.literal("0"),
  balanceWei: z.string().regex(/^\d+$/u),
  chainId: z.literal(11_155_111),
  estimatedFeeWei: z.string().regex(/^\d+$/u),
  from: z.string().regex(/^0x[0-9a-f]{40}$/iu),
  gasLimit: z.string().regex(/^\d+$/u),
  gasPriceWei: z.string().regex(/^\d+$/u),
  ownerVerified: z.literal(true),
  to: z.string().regex(/^0x[0-9a-f]{40}$/iu),
});

type Preflight = z.infer<typeof preflightSchema>;

const signingResultSchema = z.object({
  ownerVerified: z.literal(true),
  requestHash: z.string().regex(/^0x[0-9a-f]+$/iu),
  transactionHash: z.string().regex(/^0x[0-9a-f]{64}$/iu),
  typedDataSignature: z.string().regex(/^0x[0-9a-f]+$/iu),
  walletAddress: z.string().regex(/^0x[0-9a-f]{40}$/iu),
});

type SigningResult = z.infer<typeof signingResultSchema>;

const seraAccountResultSchema = z.object({
  accountBalances: z.object({
    count: z.number().int(),
    status: z.literal(200),
  }),
  accountMapping: z.object({
    privyAddress: z.string().regex(/^0x[0-9a-f]{40}$/iu),
    seraOwnerAddress: z.string().regex(/^0x[0-9a-f]{40}$/iu),
    verified: z.literal(true),
  }),
  fills: z.object({ count: z.number().int(), status: z.literal(200) }),
  orders: z.object({ count: z.number().int(), status: z.literal(200) }),
  temporaryApiKey: z.object({
    ownerVerified: z.literal(true),
    revoked: z.literal(true),
  }),
  transferBuild: z.object({
    chainId: z.literal(11_155_111),
    status: z.literal(200),
    token: z.string().regex(/^0x[0-9a-f]{40}$/iu),
  }),
});

type SeraAccountResult = z.infer<typeof seraAccountResultSchema>;

const workerUrl = import.meta.env.VITE_SPIKE_URL;

function formatEth(wei: string): string {
  const padded = BigInt(wei).toString().padStart(19, "0");
  const whole = padded.slice(0, -18);
  const decimal = padded.slice(-18).replace(/0+$/u, "").slice(0, 8);
  return `${whole}${decimal ? `.${decimal}` : ""} ETH`;
}

function PrivySpike(): React.JSX.Element {
  const { authenticated, getAccessToken, login, logout, ready, user } =
    usePrivy();
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [signingResult, setSigningResult] = useState<SigningResult | null>(
    null,
  );
  const [seraAccountResult, setSeraAccountResult] =
    useState<SeraAccountResult | null>(null);
  const [isReplayVerified, setIsReplayVerified] = useState(false);
  const [signingIdempotencyKey] = useState(
    () => `privy-spike-${crypto.randomUUID()}`,
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const wallet = useMemo(
    () =>
      user?.linkedAccounts.find(
        (account): account is WalletWithMetadata =>
          account.type === "wallet" &&
          account.chainType === "ethereum" &&
          Boolean(account.walletClientType?.startsWith("privy") && account.id),
      ),
    [user],
  );

  const runPreflight = async (): Promise<void> => {
    if (!wallet?.id || !workerUrl) return;
    setIsLoading(true);
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("Privy access token is unavailable");
      const response = await fetch(`${workerUrl}/__spike/privy-preflight`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accessToken,
          idempotencyKey: `privy-spike-${crypto.randomUUID()}`,
          walletAddress: wallet.address,
          walletId: wallet.id,
        }),
      });
      if (response.status === 403) {
        throw new Error(
          "Privyセッションとウォレット所有者が一致しません。ログアウトして再ログインしてください。",
        );
      }
      if (response.status === 409) {
        throw new Error(
          "ログインユーザーと表示中のウォレットは別のPrivyユーザーです。Privy Dashboardでこのウォレットのユーザーと同じログイン方法を選択してください。",
        );
      }
      if (!response.ok) {
        throw new Error(`Preflight failed (${response.status})`);
      }
      setPreflight(preflightSchema.parse(await response.json()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Preflight failed");
    } finally {
      setIsLoading(false);
    }
  };

  const submitSigningRequest = async (): Promise<SigningResult> => {
    if (!wallet?.id || !workerUrl) throw new Error("Wallet is unavailable");
    const accessToken = await getAccessToken();
    if (!accessToken) throw new Error("Privy access token is unavailable");
    const response = await fetch(`${workerUrl}/__spike/privy-signing`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accessToken,
        idempotencyKey: signingIdempotencyKey,
        walletAddress: wallet.address,
        walletId: wallet.id,
      }),
    });
    if (!response.ok) throw new Error(`Signing failed (${response.status})`);
    return signingResultSchema.parse(await response.json());
  };

  const runSigning = async (): Promise<void> => {
    if (!preflight || signingResult) return;
    setIsLoading(true);
    setError(null);
    try {
      setSigningResult(await submitSigningRequest());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Signing failed");
    } finally {
      setIsLoading(false);
    }
  };

  const runSigningReplay = async (): Promise<void> => {
    if (!signingResult || isReplayVerified) return;
    setIsLoading(true);
    setError(null);
    try {
      const replay = await submitSigningRequest();
      if (
        replay.transactionHash !== signingResult.transactionHash ||
        replay.requestHash !== signingResult.requestHash
      ) {
        throw new Error("Idempotency replay returned a different transaction");
      }
      setIsReplayVerified(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Replay failed");
    } finally {
      setIsLoading(false);
    }
  };

  const runSeraAccountVerification = async (): Promise<void> => {
    if (!wallet?.id || !workerUrl || seraAccountResult) return;
    setIsLoading(true);
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("Privy access token is unavailable");
      const response = await fetch(
        `${workerUrl}/__spike/sera-account-temporary-key`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accessToken,
            idempotencyKey: `privy-spike-${crypto.randomUUID()}`,
            walletAddress: wallet.address,
            walletId: wallet.id,
          }),
        },
      );
      if (!response.ok) {
        const failure = z
          .object({
            cleanupFailed: z.boolean().optional(),
            detail: z.string().optional(),
            stage: z.string().optional(),
          })
          .safeParse(await response.json());
        const reason = failure.success
          ? `${failure.data.stage ?? "unknown"}: ${failure.data.detail ?? "unknown error"}; cleanupFailed=${failure.data.cleanupFailed ?? "unknown"}`
          : `HTTP ${response.status}`;
        throw new Error(
          `Sera account verification failed (${response.status}): ${reason}`,
        );
      }
      setSeraAccountResult(
        seraAccountResultSchema.parse(await response.json()),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Sera verification failed",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main>
      <p className="eyebrow">Phase 0 · Privy signing proof</p>
      <h1>Sepolia transaction preflight</h1>
      <p className="lead">
        Privyで本人性とウォレット所有権を検証し、0
        ETHの自己送信に必要な残高と推定手数料だけを確認します。この画面からトランザクションは送信しません。
      </p>
      <section className="panel">
        {!ready && <p className="status">Privyを初期化しています…</p>}
        {ready && !authenticated && (
          <>
            <p className="status">Privyへのログインが必要です。</p>
            <div className="actions">
              <button type="button" onClick={login}>
                ログイン
              </button>
            </div>
          </>
        )}
        {ready && authenticated && (
          <>
            <p className="status">認証済み</p>
            <dl>
              <dt>Wallet</dt>
              <dd>
                {wallet?.address ?? "利用可能なEthereum埋め込みウォレットなし"}
              </dd>
              {preflight && (
                <>
                  <dt>Network</dt>
                  <dd>Sepolia ({preflight.chainId})</dd>
                  <dt>From / To</dt>
                  <dd>{preflight.from}（自己送信）</dd>
                  <dt>Amount</dt>
                  <dd>0 ETH</dd>
                  <dt>Balance</dt>
                  <dd>{formatEth(preflight.balanceWei)}</dd>
                  <dt>Estimated max fee</dt>
                  <dd>
                    {formatEth(preflight.estimatedFeeWei)} (
                    {preflight.estimatedFeeWei} wei)
                  </dd>
                </>
              )}
              {signingResult && (
                <>
                  <dt>Transaction hash</dt>
                  <dd>{signingResult.transactionHash}</dd>
                  <dt>Typed-data signature</dt>
                  <dd>{signingResult.typedDataSignature}</dd>
                  <dt>Idempotency replay</dt>
                  <dd>
                    {isReplayVerified ? "same transaction verified" : "not run"}
                  </dd>
                </>
              )}
              {seraAccountResult && (
                <>
                  <dt>Sera owner mapping</dt>
                  <dd>verified</dd>
                  <dt>Account API</dt>
                  <dd>
                    balances {seraAccountResult.accountBalances.status} / orders{" "}
                    {seraAccountResult.orders.status} / fills{" "}
                    {seraAccountResult.fills.status} / transfer build{" "}
                    {seraAccountResult.transferBuild.status}
                  </dd>
                  <dt>Temporary API key</dt>
                  <dd>verified and revoked</dd>
                </>
              )}
            </dl>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="actions">
              <button
                type="button"
                disabled={!wallet?.id || isLoading}
                onClick={runPreflight}
              >
                {isLoading ? "確認中…" : "送信内容を事前確認"}
              </button>
              {preflight && (
                <button
                  className="danger"
                  type="button"
                  disabled={isLoading || Boolean(signingResult)}
                  onClick={runSigning}
                >
                  {signingResult ? "送信済み" : "署名してSepoliaへ送信"}
                </button>
              )}
              {signingResult && (
                <button
                  type="button"
                  disabled={isLoading || isReplayVerified}
                  onClick={runSigningReplay}
                >
                  {isReplayVerified
                    ? "同一取引を確認済み"
                    : "同一キーで再送を検証"}
                </button>
              )}
              <button
                className="secondary"
                type="button"
                disabled={isLoading || Boolean(seraAccountResult)}
                onClick={runSeraAccountVerification}
              >
                {seraAccountResult
                  ? "Sera検証済み"
                  : "一時APIキーでSera account APIを検証"}
              </button>
              <button className="secondary" type="button" onClick={logout}>
                ログアウト
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

const rootElement = document.getElementById("root");
const appId = import.meta.env.VITE_PRIVY_APP_ID;

if (!rootElement || !appId) {
  throw new Error("Root element or VITE_PRIVY_APP_ID is missing");
}

createRoot(rootElement).render(
  <PrivyProvider appId={appId}>
    <PrivySpike />
  </PrivyProvider>,
);
