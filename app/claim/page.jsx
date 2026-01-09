"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";

const BASE_CHAIN_ID_DEC = 8453;
const BASE_CHAIN_ID_HEX = "0x2105";

const DEFAULT_USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DEFAULT_ETH_USD_FEED_BASE = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";

const USDC_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

const AGGREGATORV3_ABI = [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)",
];

function shortAddr(a) {
  if (!a) return "";
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function toHumanError(e) {
  const code = e?.code;
  const msg = String(e?.shortMessage || e?.message || e || "");
  if (code === "ACTION_REJECTED" || code === 4001 || msg.toLowerCase().includes("user rejected")) {
    return "Canceled in wallet";
  }
  return msg || "Error";
}

export default function ClaimPage() {
  // ===== ENV (public) =====
  const TREASURY = process.env.NEXT_PUBLIC_TREASURY_BASE_ADDRESS || "";
  const USDC_BASE = process.env.NEXT_PUBLIC_USDC_BASE || DEFAULT_USDC_BASE;
  const PAYMENT_USDC = process.env.NEXT_PUBLIC_PAYMENT_USDC || "0.1";

  const PAYMENT_USD = process.env.NEXT_PUBLIC_PAYMENT_USD || "0.1";
  const ETH_USD_FEED = process.env.NEXT_PUBLIC_CHAINLINK_ETH_USD_FEED || DEFAULT_ETH_USD_FEED_BASE;
  const ETH_PAY_SLIPPAGE_BPS = Number(process.env.NEXT_PUBLIC_ETH_PAY_SLIPPAGE_BPS || "200");

  const X_PROFILE_URL = "https://x.com/Iq_dani26";

  // ===== State =====
  const [hasWallet, setHasWallet] = useState(false);
  const [wallet, setWallet] = useState("");
  const [chainId, setChainId] = useState(null);

  const [payMethod, setPayMethod] = useState("USDC"); // "USDC" | "ETH"
  const [busyPay, setBusyPay] = useState(false);
  const [paid, setPaid] = useState(false);

  const [xLoggedIn, setXLoggedIn] = useState(false);
  const [followed, setFollowed] = useState(false);

  const [busyClaim, setBusyClaim] = useState(false);
  const [claimed, setClaimed] = useState(false);

  // prevent auto pay spam when switching quickly
  const payLockRef = useRef(false);

  // Toast (3 detik)
  const [toast, setToast] = useState(null); // {type:"ok"|"err", msg:string}
  const notify = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };

  const treasuryOk = useMemo(() => /^0x[a-fA-F0-9]{40}$/.test(TREASURY), [TREASURY]);
  const feedOk = useMemo(() => /^0x[a-fA-F0-9]{40}$/.test(ETH_USD_FEED), [ETH_USD_FEED]);

  // ===== Init wallet listeners =====
  useEffect(() => {
    setHasWallet(Boolean(typeof window !== "undefined" && window.ethereum));
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;

    const onAccountsChanged = (accs) => {
      setWallet(accs?.[0] || "");
      // reset payment-dependent states
      setPaid(false);
      setFollowed(false);
      setClaimed(false);
      payLockRef.current = false;
      refreshXStatus();
    };

    const onChainChanged = (hex) => {
      const cid = Number(BigInt(hex));
      setChainId(cid);
      setPaid(false);
      setFollowed(false);
      setClaimed(false);
      payLockRef.current = false;
    };

    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged", onChainChanged);

    return () => {
      window.ethereum.removeListener("accountsChanged", onAccountsChanged);
      window.ethereum.removeListener("chainChanged", onChainChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== X session status =====
  async function refreshXStatus() {
    try {
      const res = await fetch("/api/x/me", { cache: "no-store" });
      const j = await res.json();
      if (j?.ok && j?.loggedIn) {
        setXLoggedIn(true);
        setFollowed(Boolean(j.followed));
        setClaimed(Boolean(j.claimed));
        if (typeof j.paid === "boolean") setPaid(j.paid);
      } else {
        setXLoggedIn(false);
        setFollowed(false);
        setClaimed(false);
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    refreshXStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Wallet connect & chain =====
  async function connectWallet() {
    try {
      if (!window.ethereum) return notify("err", "No wallet found");
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      const net = await provider.getNetwork();
      setWallet(accounts?.[0] || "");
      setChainId(Number(net.chainId));
    } catch (e) {
      notify("err", toHumanError(e));
    }
  }

  async function ensureBaseNetwork() {
    if (!window.ethereum) return false;
    const provider = new ethers.BrowserProvider(window.ethereum);
    const net = await provider.getNetwork();
    if (Number(net.chainId) === BASE_CHAIN_ID_DEC) return true;

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BASE_CHAIN_ID_HEX }],
      });
      return true;
    } catch (e) {
      if (e?.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: BASE_CHAIN_ID_HEX,
                chainName: "Base",
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                rpcUrls: ["https://mainnet.base.org"],
                blockExplorerUrls: ["https://basescan.org"],
              },
            ],
          });
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  }

  async function computeEthWeiForUsd(provider, signer) {
    const feed = new ethers.Contract(ETH_USD_FEED, AGGREGATORV3_ABI, signer);

    let d = 8;
    try {
      d = await feed.decimals();
    } catch {}

    const rd = await feed.latestRoundData();
    const price = rd?.answer;
    if (price == null || BigInt(price) <= 0n) throw new Error("Price feed error");

    const usd18 = ethers.parseUnits(String(PAYMENT_USD), 18);
    let wei = (usd18 * (10n ** BigInt(d))) / BigInt(price);

    const bps = BigInt(Math.max(0, ETH_PAY_SLIPPAGE_BPS));
    wei = (wei * (10000n + bps)) / 10000n;

    return wei;
  }

  // ===== AUTO PAY on method selection =====
  async function autoPay(selectedMethod) {
    try {
      if (paid) return; // already paid
      if (busyPay) return;
      if (payLockRef.current) return; // prevent double popup spam

      if (!hasWallet) return notify("err", "No wallet found");
      if (!treasuryOk) return notify("err", "Treasury invalid");
      if (selectedMethod === "ETH" && !feedOk) return notify("err", "Feed invalid");

      if (!wallet) {
        // user must connect first
        return notify("err", "Connect wallet first");
      }

      const ok = await ensureBaseNetwork();
      if (!ok) return notify("err", "Switch to Base");

      setBusyPay(true);
      payLockRef.current = true;

      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const userAddress = await signer.getAddress();

      let txHash = "";

      if (selectedMethod === "USDC") {
        const usdc = new ethers.Contract(USDC_BASE, USDC_ABI, signer);
        let dec = 6;
        try {
          dec = await usdc.decimals();
        } catch {}
        const amount = ethers.parseUnits(String(PAYMENT_USDC), dec);

        // popup confirm
        const tx = await usdc.transfer(TREASURY, amount);
        txHash = tx.hash;
        await tx.wait(1);
      } else {
        const wei = await computeEthWeiForUsd(provider, signer);

        // popup confirm
        const tx = await signer.sendTransaction({ to: TREASURY, value: wei });
        txHash = tx.hash;
        await tx.wait(1);
      }

      // server confirm
      const res = await fetch("/api/payment/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: userAddress, method: selectedMethod, txHash }),
      });
      const j = await res.json();
      if (!j?.ok) {
        setBusyPay(false);
        payLockRef.current = false; // allow retry
        return notify("err", j?.error || "Payment verify failed");
      }

      setPaid(true);
      notify("ok", "Paid ✓");
      setBusyPay(false);

      // keep lock; if user switches method after paid, no more popup
      refreshXStatus();
    } catch (e) {
      setBusyPay(false);
      payLockRef.current = false; // allow retry
      notify("err", toHumanError(e));
    }
  }

  function onSelectMethod(m) {
    setPayMethod(m);
    // auto trigger payment popup
    autoPay(m);
  }

  // ===== Twitter button (connect -> follow) =====
  function handleTwitterButton() {
    if (!paid) return notify("err", "Pay first");
    if (!xLoggedIn) {
      window.location.href = "/api/x/login";
      return;
    }
    // already logged in -> act as Follow
    handleFollow();
  }

  async function handleFollow() {
    try {
      window.open(X_PROFILE_URL, "_blank", "noopener,noreferrer");

      const res = await fetch("/api/x/follow", { method: "POST" });
      const j = await res.json();
      if (!j?.ok) return notify("err", j?.error || "Follow failed");

      setFollowed(true);
      notify("ok", "Follow ✓");
      refreshXStatus();
    } catch (e) {
      notify("err", toHumanError(e));
    }
  }

  // ===== Claim =====
  async function handleClaim() {
    try {
      if (!wallet) return notify("err", "Connect wallet");
      setBusyClaim(true);

      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet }),
      });
      const j = await res.json();

      if (!j?.ok) {
        setBusyClaim(false);
        return notify("err", j?.error || "Claim failed");
      }

      setClaimed(true);
      notify("ok", "Claim sent ✓");
      setBusyClaim(false);
      refreshXStatus();
    } catch (e) {
      setBusyClaim(false);
      notify("err", toHumanError(e));
    }
  }

  // ===== visibility/disabled rules =====
  const methodDisabled = !wallet || paid || busyPay;
  const twitterDisabled = !paid || (xLoggedIn && followed); // if already followed, no need
  const claimVisible = paid && xLoggedIn && followed && !claimed;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-4">
      {/* Toast */}
      {toast ? (
        <div
          className={[
            "fixed top-5 right-5 z-50 rounded-xl px-4 py-3 text-sm border",
            toast.type === "ok"
              ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-200"
              : "bg-red-500/15 border-red-500/30 text-red-200",
          ].join(" ")}
        >
          {toast.msg}
        </div>
      ) : null}

      <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
        {/* header minimal */}
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Claim</div>
          <div className="text-xs text-neutral-400">{wallet ? shortAddr(wallet) : ""}</div>
        </div>

        {/* connect wallet */}
        <button
          onClick={connectWallet}
          className="mt-4 w-full rounded-xl bg-white text-neutral-900 font-medium py-2 hover:bg-neutral-200"
        >
          {wallet ? "Wallet Connected" : "Connect Wallet"}
        </button>

        {/* payment choice (auto triggers popup) */}
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onSelectMethod("USDC")}
            disabled={methodDisabled}
            className={[
              "flex-1 rounded-xl py-2 text-sm border",
              payMethod === "USDC"
                ? "bg-white text-neutral-900 border-white"
                : "bg-transparent text-neutral-200 border-neutral-700 hover:bg-neutral-800",
              methodDisabled ? "opacity-70 cursor-not-allowed" : "",
            ].join(" ")}
          >
            {busyPay && payMethod === "USDC" ? "USDC..." : "USDC"}
          </button>

          <button
            onClick={() => onSelectMethod("ETH")}
            disabled={methodDisabled}
            className={[
              "flex-1 rounded-xl py-2 text-sm border",
              payMethod === "ETH"
                ? "bg-white text-neutral-900 border-white"
                : "bg-transparent text-neutral-200 border-neutral-700 hover:bg-neutral-800",
              methodDisabled ? "opacity-70 cursor-not-allowed" : "",
            ].join(" ")}
          >
            {busyPay && payMethod === "ETH" ? "ETH..." : "ETH"}
          </button>
        </div>

        {/* twitter button: connect -> follow */}
        <button
          onClick={handleTwitterButton}
          disabled={!paid || (xLoggedIn && followed)}
          className={[
            "mt-3 w-full rounded-xl py-2 text-sm border border-neutral-700 hover:bg-neutral-800",
            (!paid || (xLoggedIn && followed)) ? "opacity-60 cursor-not-allowed" : "",
          ].join(" ")}
        >
          {!xLoggedIn ? "Connect Twitter" : followed ? "Followed" : "Follow @Iq_dani26"}
        </button>

        {/* claim */}
        {claimVisible ? (
          <div className="mt-3">
            <button
              onClick={handleClaim}
              disabled={busyClaim}
              className={[
                "w-full rounded-xl py-2 font-medium",
                busyClaim ? "bg-neutral-700 text-neutral-300 cursor-not-allowed" : "bg-white text-neutral-900 hover:bg-neutral-200",
              ].join(" ")}
            >
              Claim {REWARD_USDC} USDT
            </button>
            <div className="mt-1 text-center text-[11px] text-neutral-500">Arc Testnet</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
