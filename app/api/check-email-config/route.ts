import { NextRequest, NextResponse } from 'next/server'
import { validateEmailConfig } from '@/lib/email-service'

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 [EMAIL-CONFIG] ===== CHECKING EMAIL CONFIGURATION =====')
    console.log('🔍 [EMAIL-CONFIG] Environment:', process.env.NODE_ENV)
    console.log('🔍 [EMAIL-CONFIG] Timestamp:', new Date().toISOString())
    
    // Verifică variabilele de mediu
    const envCheck = {
      NODE_ENV: process.env.NODE_ENV,
      GMAIL_USER: process.env.GMAIL_USER ? 'SET' : 'NOT SET',
      GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD ? 'SET' : 'NOT SET',
      GMAIL_USER_VALUE: process.env.GMAIL_USER || 'MISSING',
      GMAIL_APP_PASSWORD_LENGTH: process.env.GMAIL_APP_PASSWORD ? process.env.GMAIL_APP_PASSWORD.length : 0,
    }
    
    console.log('🔍 [EMAIL-CONFIG] Environment check:', envCheck)
    
    // Validează configurația email
    const emailConfig = validateEmailConfig()
    console.log('🔍 [EMAIL-CONFIG] Validation result:', emailConfig)
    
    // Testează importul modulului nodemailer
    let nodemailerStatus = 'OK'
    try {
      const nodemailer = require('nodemailer')
      nodemailerStatus = 'IMPORTED'
    } catch (error) {
      nodemailerStatus = `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
    
    // Testează importul modulului qrcode
    let qrcodeStatus = 'OK'
    try {
      const qrcode = require('qrcode')
      qrcodeStatus = 'IMPORTED'
    } catch (error) {
      qrcodeStatus = `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
    
    const diagnosticResult = {
      success: true,
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
      emailConfig: {
        isValid: emailConfig.isValid,
        missingVars: emailConfig.missingVars,
        gmailUser: process.env.GMAIL_USER ? 'SET' : 'NOT SET',
        gmailPassword: process.env.GMAIL_APP_PASSWORD ? 'SET' : 'NOT SET',
        gmailUserValue: process.env.GMAIL_USER || 'MISSING',
        gmailPasswordLength: process.env.GMAIL_APP_PASSWORD ? process.env.GMAIL_APP_PASSWORD.length : 0,
      },
      modules: {
        nodemailer: nodemailerStatus,
        qrcode: qrcodeStatus,
      },
      vercel: {
        region: process.env.VERCEL_REGION || 'N/A',
        url: process.env.VERCEL_URL || 'N/A',
      }
    }
    
    console.log('✅ [EMAIL-CONFIG] Diagnostic complete:', diagnosticResult)
    
    return NextResponse.json(diagnosticResult, { status: 200 })
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('❌ [EMAIL-CONFIG] Diagnostic error:', errorMessage)
    console.error('❌ [EMAIL-CONFIG] Error stack:', error instanceof Error ? error.stack : 'N/A')
    
    return NextResponse.json({
      success: false,
      error: errorMessage,
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
    }, { status: 500 })
  }
} 