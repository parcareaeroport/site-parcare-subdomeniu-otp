'use client'

import { useState } from 'react'

export default function TestAuthPage() {
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const testOblioAuth = async () => {
    setLoading(true)
    setResult(null)
    
    try {
      const response = await fetch('/api/test-oblio-auth', {
        method: 'POST',
      })
      
      const data = await response.json()
      setResult(data)
    } catch (error) {
      setResult({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-6">
        <h1 className="text-2xl font-bold mb-6 text-gray-800">🧾 Test Autentificare Oblio</h1>
        
        <div className="mb-6">
          <button
            onClick={testOblioAuth}
            disabled={loading}
            className="bg-waze-blue hover:bg-waze-blue/80 disabled:bg-gray-400 text-white px-6 py-3 rounded-lg font-medium"
          >
            {loading ? '🔄 Testez...' : '🔐 Testează Autentificarea'}
          </button>
        </div>

        {result && (
          <div className={`p-4 rounded-lg ${result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            <h2 className="font-bold mb-2">
              {result.success ? '✅ Succes' : '❌ Eroare'}
            </h2>
            
            <pre className="text-sm overflow-auto bg-gray-100 p-3 rounded">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}

        <div className="mt-6 text-sm text-gray-600">
          <p><strong>Ce testează:</strong></p>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>Verificarea variabilelor de mediu Oblio</li>
            <li>Autentificarea cu API-ul Oblio</li>
            <li>Obținerea token-ului de acces</li>
            <li>Diagnosticarea erorilor de autentificare</li>
          </ul>
        </div>
      </div>
    </div>
  )
} 