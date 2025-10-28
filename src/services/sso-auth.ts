import { Storage } from "@plasmohq/storage"

const storage = new Storage()

export interface SSOCredentials {
  userid: string
  password: string
  otp?: string
  otp_type?: string
}

export interface SSOTokenResponse {
  access_token: string
  scope: string
  id_token: string
  token_type: string
  expires_in: number
  nonce: string
}

export interface GeminiAPIConfig {
  ssoUrl: string
  geminiApiUrl: string
  projectId: string
  location: string
  model: string
}

// Storage keys
const SSO_TOKEN_KEY = "sso_access_token"
const SSO_TOKEN_EXPIRY_KEY = "sso_token_expiry"
const SSO_CREDENTIALS_KEY = "sso_credentials"
const GEMINI_CONFIG_KEY = "gemini_api_config"

/**
 * Get stored SSO credentials
 */
export const getSSOCredentials = async (): Promise<SSOCredentials | null> => {
  const credentials = await storage.get(SSO_CREDENTIALS_KEY)
  return credentials ? JSON.parse(credentials) : null
}

/**
 * Store SSO credentials
 */
export const setSSOCredentials = async (credentials: SSOCredentials): Promise<void> => {
  await storage.set(SSO_CREDENTIALS_KEY, JSON.stringify(credentials))
}

/**
 * Get stored Gemini API configuration
 */
export const getGeminiConfig = async (): Promise<GeminiAPIConfig | null> => {
  const config = await storage.get(GEMINI_CONFIG_KEY)
  return config ? JSON.parse(config) : null
}

/**
 * Store Gemini API configuration
 */
export const setGeminiConfig = async (config: GeminiAPIConfig): Promise<void> => {
  await storage.set(GEMINI_CONFIG_KEY, JSON.stringify(config))
}

/**
 * Get stored access token
 */
export const getAccessToken = async (): Promise<string | null> => {
  const token = await storage.get(SSO_TOKEN_KEY)
  const expiry = await storage.get(SSO_TOKEN_EXPIRY_KEY)
  
  if (!token || !expiry) {
    return null
  }
  
  // Check if token has expired
  if (Date.now() >= parseInt(expiry)) {
    await clearTokens()
    return null
  }
  
  return token
}

/**
 * Store access token with expiry
 */
export const setAccessToken = async (tokenResponse: SSOTokenResponse): Promise<void> => {
  const expiryTime = Date.now() + (tokenResponse.expires_in * 1000) - (5 * 60 * 1000) // 5 minutes buffer
  
  await storage.set(SSO_TOKEN_KEY, tokenResponse.access_token)
  await storage.set(SSO_TOKEN_EXPIRY_KEY, expiryTime.toString())
}

/**
 * Clear stored tokens
 */
export const clearTokens = async (): Promise<void> => {
  await storage.remove(SSO_TOKEN_KEY)
  await storage.remove(SSO_TOKEN_EXPIRY_KEY)
}

/**
 * Perform SSO login
 */
export const performSSOLogin = async (ssoUrl: string, credentials: SSOCredentials): Promise<SSOTokenResponse> => {
  console.log('🔧 SSO Login attempt:', {
    url: ssoUrl,
    userid: credentials.userid,
    otp_type: credentials.otp_type
  })

  try {
    // Check if the URL is accessible first
    console.log('🔧 Testing SSO endpoint accessibility...')
    
    const requestBody = {
      userid: credentials.userid,
      password: credentials.password,
      otp: credentials.otp || "NONE",
      otp_type: credentials.otp_type || "PUSH"
    }
    
    console.log('🔧 Request body:', {
      userid: requestBody.userid,
      otp: requestBody.otp,
      otp_type: requestBody.otp_type,
      password: '[HIDDEN]'
    })

    const response = await fetch(ssoUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      // Add these options to handle potential CORS and network issues
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow'
    })

    console.log('🔧 Response status:', response.status, response.statusText)
    console.log('🔧 Response headers:', Object.fromEntries(response.headers.entries()))

    if (!response.ok) {
      // Get response body for better error details
      let errorDetails = ''
      try {
        errorDetails = await response.text()
        console.log('🔧 Error response body:', errorDetails)
      } catch (e) {
        console.log('🔧 Could not read error response body')
      }
      
      throw new Error(`SSO login failed: ${response.status} ${response.statusText}. Details: ${errorDetails}`)
    }

    const tokenResponse: SSOTokenResponse = await response.json()
    console.log('✅ SSO login successful, token received')
    
    // Store the token
    await setAccessToken(tokenResponse)
    
    return tokenResponse
  } catch (error) {
    console.error('❌ SSO login error:', error)
    
    // Provide more specific error messages
    if (error.message === 'Failed to fetch') {
      throw new Error(`Network error: Cannot reach SSO endpoint at ${ssoUrl}. This might be due to:
        1. CORS policy blocking the request
        2. Network connectivity issues
        3. SSL certificate problems
        4. Firewall or VPN restrictions
        
        Please check your network connection and ensure the endpoint is accessible.`)
    }
    
    throw error
  }
}

/**
 * Get valid access token (refresh if needed)
 */
export const getValidAccessToken = async (): Promise<string> => {
  // Try to get existing valid token
  let token = await getAccessToken()
  
  if (token) {
    return token
  }
  
  // Token is expired or doesn't exist, try to refresh
  const credentials = await getSSOCredentials()
  const config = await getGeminiConfig()
  
  if (!credentials || !config) {
    throw new Error('No stored credentials or config found. Please configure SSO settings.')
  }
  
  const tokenResponse = await performSSOLogin(config.ssoUrl, credentials)
  return tokenResponse.access_token
}

/**
 * Check if SSO is configured
 */
export const isSSOConfigured = async (): Promise<boolean> => {
  const credentials = await getSSOCredentials()
  const config = await getGeminiConfig()
  
  return !!(credentials && config && credentials.userid && credentials.password && config.ssoUrl && config.geminiApiUrl)
}