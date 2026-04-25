/**
 * lib/arcChain.test.ts
 * Unit tests untuk arcChain constants dan helpers.
 */

import { describe, it, expect } from 'vitest'
import {
  ARC_CHAIN_ID, ARC_CCTP_DOMAIN, CCTP_MAX_FEE,
  BRIDGE_KIT_CHAIN_ARC, BRIDGE_KIT_CHAIN_SEPOLIA,
  makeArcPublicClient, makeSepoliaPublicClient,
  ARC_USDC, ARC_EURC, ARC_FX_ESCROW,
  ARC_TOKEN_MESSENGER, ARC_MESSAGE_TRANSMITTER,
  SEPOLIA_USDC, SEPOLIA_CHAIN_ID,
} from './arcChain'

describe('arcChain — constants', () => {
  it('ARC_CHAIN_ID = 5042002', () => {
    expect(ARC_CHAIN_ID).toBe(5042002)
  })

  it('ARC_CCTP_DOMAIN = 26', () => {
    expect(ARC_CCTP_DOMAIN).toBe(26)
  })

  it('CCTP_MAX_FEE = 1000n (0.001 USDC)', () => {
    expect(CCTP_MAX_FEE).toBe(1_000n)
  })

  it('BRIDGE_KIT_CHAIN_ARC = "Arc_Testnet"', () => {
    expect(BRIDGE_KIT_CHAIN_ARC).toBe('Arc_Testnet')
  })

  it('BRIDGE_KIT_CHAIN_SEPOLIA = "Ethereum_Sepolia"', () => {
    expect(BRIDGE_KIT_CHAIN_SEPOLIA).toBe('Ethereum_Sepolia')
  })

  it('ARC_USDC is valid address', () => {
    expect(ARC_USDC).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })

  it('ARC_EURC is valid address', () => {
    expect(ARC_EURC).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })

  it('ARC_FX_ESCROW is valid address', () => {
    expect(ARC_FX_ESCROW).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })

  it('ARC_TOKEN_MESSENGER is valid address', () => {
    expect(ARC_TOKEN_MESSENGER).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })

  it('ARC_MESSAGE_TRANSMITTER is valid address', () => {
    expect(ARC_MESSAGE_TRANSMITTER).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })

  it('SEPOLIA_USDC is valid address', () => {
    expect(SEPOLIA_USDC).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })

  it('SEPOLIA_CHAIN_ID = 11155111', () => {
    expect(SEPOLIA_CHAIN_ID).toBe(11155111)
  })
})

describe('arcChain — makeArcPublicClient', () => {
  it('returns a valid viem public client with correct chain id', () => {
    const client = makeArcPublicClient()
    expect(client).toBeDefined()
    expect(client.chain?.id).toBe(ARC_CHAIN_ID)
  })
})

describe('arcChain — makeSepoliaPublicClient', () => {
  it('returns a valid viem public client with correct chain id', () => {
    const client = makeSepoliaPublicClient()
    expect(client).toBeDefined()
    expect(client.chain?.id).toBe(SEPOLIA_CHAIN_ID)
  })
})
