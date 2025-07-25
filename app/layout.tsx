import type React from "react"
import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import Script from "next/script"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"
import WhatsAppFloating from "@/components/whatsapp-floating"

const inter = Inter({ subsets: ["latin"], display: "swap" })

export const viewport: Viewport = {
      themeColor: "#ee7f1a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
}

export const metadata: Metadata = {
  title: {
    template: "%s | OTP Parking",
    default: "OTP Parking - Parcare Privată Otopeni - Tarif Mic",
  },
  description:
    "Alege inteligent, alege siguranța, alege confortul. Alege OTP Parking la un tarif avantajos pentru tine!",
  keywords: [
    "parcare aeroport otopeni",
    "parcare henri coanda",
    "parcare aeroport bucuresti",
    "rezervare parcare otopeni",
    "parcare sigura aeroport",
    "transfer aeroport otopeni",
  ],
  authors: [{ name: "OTP Parking SRL" }],
  creator: "OTP Parking SRL",
  publisher: "OTP Parking SRL",
  formatDetection: {
    telephone: true,
    email: true,
    address: true,
  },
  metadataBase: new URL("https://parcare-aeroport.ro"),
  alternates: {
    canonical: "/",
    languages: {
      ro: "/",
      en: "/en",
    },
  },
  openGraph: {
    type: "website",
    locale: "ro_RO",
    url: "https://parcare-aeroport.ro",
    title: "OTP Parking - Parcare Privată Otopeni - Tarif Mic",
    description:
      "Alege inteligent, alege siguranța, alege confortul. Alege OTP Parking la un tarif avantajos pentru tine!",
    siteName: "OTP Parking",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "OTP Parking",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "OTP Parking - Parcare Privată Otopeni - Tarif Mic",
    description:
      "Alege inteligent, alege siguranța, alege confortul. Alege OTP Parking la un tarif avantajos pentru tine!",
    images: ["/og-image.jpg"],
    creator: "@parcareaeroport",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    google: "verificare-google",
  },
  icons: {
    icon: [
      { url: '/icon.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [
      { url: '/icon.png', sizes: '180x180', type: 'image/png' },
    ],
    shortcut: '/icon.png',
  },
  generator: 'v0.dev'
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ro" className="scroll-smooth">
      <head>
        {/* Enhanced Theme Color Support */}
        <meta name="theme-color" content="#ee7f1a" />
        <meta name="msapplication-TileColor" content="#ee7f1a" />
        <meta name="msapplication-navbutton-color" content="#ee7f1a" />
        <meta name="apple-mobile-web-app-status-bar-style" content="#ee7f1a" />
        
        {/* FontAwesome for icons */}
        <link 
          rel="stylesheet" 
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
          integrity="sha512-DTOQO9RWCH3ppGqcWaEA1BIZOC6xxalwEsw9c2QQeAIftl+Vegovlnee1c9QX4TctnWMn13TZye+giMm8e2LwA=="
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
        />
        
        {/* Google Tag Manager */}
        <Script
          id="gtm-script"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
            (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
            new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
            j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
            'https://patrack.parcare-aeroport.ro/6kwxp/c4ti0.js?id='+i+dl;f.parentNode.insertBefore(j,f);
            })(window,document,'script','dataLayer','KRNVVQM6');
            `,
          }}
        />
        
        {/* Google Analytics 4 */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-TQ1MH8BPPJ"
          strategy="afterInteractive"
        />
        <Script
          id="ga4-script"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-TQ1MH8BPPJ');
            `,
          }}
        />

        {/* Meta Pixel Code */}
        <Script
          id="fb-pixel"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '1357415508822546');
            fbq('track', 'PageView');
            `,
          }}
        />

        {/* TikTok Pixel Code */}
        <Script
          id="tiktok-pixel"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
            !function (w, d, t) {
              w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(
              var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script")
              ;n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};
              ttq.load('D1HV0B3C77U195PQQ05G');
              ttq.page();
            }(window, document, 'ttq');
            `,
          }}
        />

        {/* Cookie Extension Script */}
        <Script
          id="cookie-extension"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
            function _tg_generateUUID(){return"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(t){var e=16*Math.random()|0;return("x"==t?e:3&e|8).toString(16)})}function _tg_getMainDomain(){var t=window.location.hostname.split(".");return 2<t.length?"."+t.slice(-2).join("."):window.location.hostname}function _tg_setCookie(t,e,i){var n=new Date,i=(n.setDate(n.getDate()+i),_tg_getMainDomain());document.cookie=t+"="+e+";expires="+n.toUTCString()+";path=/;domain="+i}function _tg_getCookie(e){var i=document.cookie.split(";");for(let t=0;t<i.length;t++){var n=i[t].trim();if(n.startsWith(e+"="))return n.substring(e.length+1)}return null}function _tg_isSafari(){var t=navigator.userAgent.toLowerCase();return t.includes("safari")&&!t.includes("chrome")}function _tg_setVisitorId(){var t="_tg_visitor_id";let e=localStorage.getItem(t);return e||(e=_tg_generateUUID(),localStorage.setItem(t,e)),_tg_isSafari()&&_tg_setCookie("_tg_visitor_id",e,365),e}_tg_setVisitorId();
            `,
          }}
        />
      </head>
      <body className={inter.className}>
        {/* Google Tag Manager (noscript) */}
        <noscript>
          <iframe 
            src="https://www.googletagmanager.com/ns.html?id=KRNVVQM6"
            height="0" 
            width="0" 
            style={{display:"none", visibility:"hidden"}}
          />
        </noscript>
        {/* End Google Tag Manager (noscript) */}

        {/* Meta Pixel Code (noscript) */}
        <noscript>
          <img 
            height="1" 
            width="1" 
            style={{display:"none"}}
            src="https://www.facebook.com/tr?id=1357415508822546&ev=PageView&noscript=1"
            alt=""
          />
        </noscript>
        {/* End Meta Pixel Code (noscript) */}
        
        {children}
        <WhatsAppFloating />
        <Toaster />
      </body>
    </html>
  )
}
