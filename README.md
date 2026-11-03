# Safari Old Version Simulator

## Masaüstü uygulaması (macOS)

Proje klasöründe ilk kez `npm install` çalıştır, ardından:

```bash
npm run desktop
```

Arayüzde Safari sürümünü ve açılacak adresi seçip **Tarayıcıyı aç** düğmesine bas. Yaklaşık eşleşen sürümler (örneğin Safari 15.6 → WebKit 15.4) için uyarıyı onaylamak gerekir. İlk kullanımda seçilen Playwright paketi ve WebKit indirilir. Açılan pencereyi veya arayüzdeki **Tarayıcıyı kapat** düğmesini kullanarak kapatabilirsin. Seçim sonraki açılış için saklanır.

Çift tıklanabilir macOS uygulamasını oluşturmak için:

```bash
npm run desktop:build
```

Çıktı `dist/mac-arm64/Safari Simulator.app` yolundadır. Masaüstü paketi Node 22 ve npm içerir; kullanıcıda ayrıca Node kurulumu gerekmez. İndirilen motorlar uygulamanın kullanıcı verisi klasöründe saklanır. Bu yerel yapı Apple Developer ID ile imzalanıp noterlenmediği için başka Mac'lere dağıtmadan önce imzalama ve noterleme gerekir.

Masaüstü arayüzü Safari'nin kendi adres çubuğunu veya arayüzünü taklit etmez; seçilen WebKit sayfası ayrı bir Playwright penceresinde açılır.

Ayar dosyasındaki Safari hedefini okuyup o sürüm ailesine karşılık gelen **Playwright WebKit** derlemesini açar. Her Playwright sürümü ayrı kurulur; sürüm değişince güncel WebKit'e sessizce geçilmez.

## Kullanım

Node.js 22 LTS ve npm önerilir. NVM kullanıyorsan önce `nvm install && nvm use` çalıştır. İlk çalıştırma seçilen Playwright paketini ve WebKit'i internetten indirir. Proje kökünde:

```bash
npm start
```

`safari.config.json`:

```json
{
  "safariVersion": "15.6.0",
  "allowApproximateVersion": true,
  "url": "http://localhost:3000",
  "headless": false,
  "viewport": { "width": 1440, "height": 900 },
  "ignoreHTTPSErrors": false
}
```

Dosya başlangıçta okunur; değişiklikten sonra scripti yeniden çalıştır. Varsayılan URL `about:blank`. Pencereyi kapat veya Ctrl+C ile çık.

```bash
npm run check                 # Ayarı ve seçilen derlemeyi gösterir; indirme yapmaz
npm run browsers:install               # Yalnızca seçilen WebKit'i hazırlar
npm run smoke                 # Pencere açmadan motor, DOM, JavaScript ve CSS kontrolü
npm test                      # Sürüm seçimi ve ayar doğrulama testleri
npm start -- --config ./safari.config.json
```

## Safari 15 yaklaşık hedefleri

15.0 ve 15.4 için ayrı Playwright WebKit derlemeleri var. 15.1, 15.2 ve 15.3 seçimleri yaklaşık olarak WebKit 15.0; 15.5 ve 15.6 seçimleri yaklaşık olarak WebKit 15.4 kullanır. Bunlar ilgili Safari sürümünün birebir karşılığı değildir. `15.6.0` da `15.6` gibi kabul edilir.

Yaklaşık seçimler için ayarda `"allowApproximateVersion": true` zorunludur. Script hedefi ve kullanılan motoru gösterir, açık uyarı verir ve User-Agent'i hedef Safari sürümüne göre değiştirmez. Bu ayarı kapatınca eşleşmeyen hedefler hata verir. Mevcut `15.6.0` seçimi için yaklaşık kullanım açılmıştır.

## Doğrudan eşlenen hedefler

| safariVersion | Playwright | WebKit revision |
| --- | --- | --- |
| 15.0 / 15.0.0 | 1.15.2 | 1550 |
| 15.4 / 15.4.0 | 1.23.4 | 1668 |
| 16.4 / 16.4.0 | 1.32.1 | 1811 |
| 17.0 / 17.0.0 | 1.37.1 | 1883 |
| 17.4 / 17.4.0 | 1.43.1 | 1992 |
| 18.0 / 18.0.0 | 1.48.2 | 2083 |
| 18.4 / 18.4.0 | 1.52.0 | 2158 |

Eşlemeler ilgili Playwright sürümünün resmi `browsers.json` dosyasından alınır. Playwright 1.22 öncesinde motor sürümü bu dosyada yer almadığından, 15.0 etiketi aynı sürümün `wkBrowser.ts` dosyasından doğrulanır; kurulumda paketin `wkBrowser.js` dosyası kontrol edilir. Kaynak bağlantıları `webkit-versions.json` içinde. Yeni hedef eklerken Playwright sürümünü, WebKit sürümünü ve revision değerini aynı kaynaktan doğrula.

## Kendi Playwright scriptinden kullanma

```js
import { openSafari } from './scripts/safari.mjs';

const { browser, page } = await openSafari();
try {
  await page.goto('http://localhost:3000');
  console.log(await page.title());
  // await page.locator('...').click();
} finally {
  await browser.close();
}
```

`openSafari('./başka-ayar.json', { headless: true })` da kullanılabilir. Aynı Node sürecinde tek motor sürümü kullan; sürüm değiştirmek için yeni bir süreç başlat.

## Simülasyonun sınırları

Playwright gerçek Safari.app veya geçmiş macOS/iOS sürümünü başlatmaz; kendi yamalı WebKit derlemesini çalıştırır. `16.4.0`, WebKit 16.4 ailesi için bir seçim adıdır; birebir Safari 16.4.0 yama sürümü değildir. Aynı WebKit sürüm etiketi içindeki revision'lar da farklı olabilir. User-Agent değiştirilerek motor sürümü taklit edilmez.

Safari arayüzü, Apple DRM/FairPlay, sistem codec'leri, HLS entegrasyonu ve iOS davranışı gerçek cihazla aynı olmayabilir. Birebir Safari sürümü gerekiyorsa o sürümü taşıyan macOS/iOS cihazı, sanal makine veya gerçek Safari sunan uzak test servisi gerekir.

Eski WebKit derlemelerinin çalışması işletim sistemi ve mimariye bağlıdır. Playwright eski sistemlerde başka bir revision kullanabilir; script açılan motorun sürümünü doğrular ve yanlış sürümde hata verir. Yeni sistemlerde de eski derleme açılmayabilir. Başarısız indirmede veya açılışta yeni sürüme otomatik geçmez.

İndirilen paketler `.runtimes/playwright-<sürüm>/`, tarayıcılar `.runtimes/browsers/` altında tutulur ve sonraki çalıştırmalarda kullanılır.

Eski Playwright kurucusu Node 26 ile arşivi eksik açabilir. Script indirme gerektiğinde Node 20/22 kullanır; mevcut NVM kurulumlarında bunu otomatik bulur. Başka konumdaki Node için `SAFARI_INSTALL_NODE=/tam/yol/node npm start` kullan. Eksik bir kurulum sonraki denemede `.runtimes/incomplete-*` altına taşınır ve yeniden indirilir.

macOS 26 üzerinde WebKit 15'in eski süreç profilleri, yeni sistemin kullandığı `ulock_wait2` (syscall 544) çağrısını engelleyip WebContent sürecini kapatabilir. Script bu sistemlerde WebKit 15'in WebContent, Network ve GPU profillerine yalnızca `SYS_ulock_wait2` iznini ekler; aynı izin WebKit 16.4'ün profillerinde bulunur. Orijinal dosyalar aynı klasörde `.safari-simulator.original` uzantısıyla yedeklenir. Sandbox diğer kurallarıyla etkin kalır; motor ikili dosyaları değiştirilmez.
