# Requirements Document

## Introduction

Fitur ini menambahkan tab **Swap** yang tampil sejajar (side-by-side) dengan tab **Bridge** yang sudah ada di halaman `/dapp` Arc Network DApp. Tab Swap memungkinkan pengguna menukar token (USDC, EURC, USYC, dan ARC native) di Arc Testnet. Karena DEX native belum tersedia di testnet, UI ditampilkan lengkap namun dalam disabled/coming-soon state dengan notifikasi yang jelas. Fitur ini mencakup komponen-komponen baru: `SwapPanel.tsx` (upgrade), `useSwapQuote.ts`, `useSwapExecute.ts`, `TokenSelector.tsx`, `SlippageSettings.tsx`, serta update pada navigasi tab di `app/dapp/page.tsx`.

---

## Glossary

- **SwapPanel**: Komponen utama yang menampilkan antarmuka swap token.
- **TabNavigation**: Elemen UI berupa dua tombol tab (Bridge dan Swap) yang tampil berdampingan di halaman DApp.
- **TokenSelector**: Modal/dropdown untuk memilih token FROM atau TO.
- **SlippageSettings**: Komponen pengaturan toleransi slippage.
- **QuoteRefresher**: Mekanisme auto-refresh quote setiap 15 detik beserta countdown timer visual.
- **PriceImpactIndicator**: Indikator warna yang menunjukkan dampak harga dari swap.
- **ReverseButton**: Tombol ⇄ di antara field FROM dan TO untuk membalik arah swap.
- **ConfirmationModal**: Modal konfirmasi sebelum eksekusi swap.
- **DEX**: Decentralized Exchange — platform pertukaran token onchain.
- **Slippage**: Toleransi perbedaan harga antara quote dan eksekusi aktual.
- **Price Impact**: Persentase perubahan harga akibat ukuran order terhadap likuiditas pool.
- **Minimum Received**: Jumlah minimum token yang diterima setelah memperhitungkan slippage.
- **ARC_USDC**: Token USDC di Arc Testnet, address `0x3600000000000000000000000000000000000000`.
- **ARC_EURC**: Token EURC di Arc Testnet, address `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`.
- **ARC_USYC**: Token USYC di Arc Testnet, address `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C`.
- **System**: Arc Network DApp secara keseluruhan.

---

## Requirements

### Requirement 1: Tab Navigasi Side-by-Side

**User Story:** Sebagai pengguna DApp, saya ingin melihat tab Bridge dan Swap berdampingan di halaman `/dapp`, sehingga saya dapat berpindah antara fitur Bridge dan Swap dengan mudah tanpa navigasi tambahan.

#### Acceptance Criteria

1. THE TabNavigation SHALL menampilkan tab "Bridge" dan tab "Swap" secara berdampingan (side-by-side) dalam satu baris yang sama.
2. THE TabNavigation SHALL menampilkan tab Bridge dan tab Swap dengan ukuran, padding, dan font yang identik.
3. WHEN pengguna mengklik tab "Swap", THE TabNavigation SHALL mengaktifkan tab Swap dan menampilkan SwapPanel sebagai konten utama.
4. WHEN pengguna mengklik tab "Bridge", THE TabNavigation SHALL mengaktifkan tab Bridge dan menampilkan BridgePanel sebagai konten utama.
5. WHEN sebuah tab aktif, THE TabNavigation SHALL menampilkan tab tersebut dengan background highlight (`bg-zinc-800`) dan teks terang (`text-zinc-100`).
6. WHEN sebuah tab tidak aktif, THE TabNavigation SHALL menampilkan tab tersebut dengan teks muted (`text-zinc-500`) dan efek hover (`hover:text-zinc-300`).
7. THE TabNavigation SHALL menggunakan palet warna zinc/emerald/sky yang konsisten dengan design system yang sudah ada.
8. THE TabNavigation SHALL TIDAK menggunakan nested tab, dropdown, atau navigasi halaman terpisah.

---

### Requirement 2: Token Support

**User Story:** Sebagai pengguna, saya ingin memilih dari daftar token yang tersedia di Arc Network, sehingga saya dapat menukar token yang saya miliki.

#### Acceptance Criteria

1. THE TokenSelector SHALL mendukung token USDC (address `0x3600000000000000000000000000000000000000`, 6 desimal).
2. THE TokenSelector SHALL mendukung token EURC (address `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`, 6 desimal).
3. THE TokenSelector SHALL mendukung token USYC (address `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C`, 6 desimal).
4. WHEN pengguna membuka TokenSelector, THE TokenSelector SHALL menampilkan nama token, simbol, dan saldo pengguna untuk setiap token yang tersedia.
5. THE SwapPanel SHALL menggunakan USDC sebagai token FROM default saat pertama kali dimuat.
6. THE SwapPanel SHALL menggunakan EURC sebagai token TO default saat pertama kali dimuat.
7. IF pengguna memilih token yang sama untuk FROM dan TO, THEN THE TokenSelector SHALL secara otomatis menukar token lainnya untuk menghindari pasangan token identik.

---

### Requirement 3: Swap Flow dan Quote Display

**User Story:** Sebagai pengguna, saya ingin melihat informasi lengkap tentang swap sebelum mengeksekusinya, sehingga saya dapat membuat keputusan yang tepat.

#### Acceptance Criteria

1. WHEN pengguna memasukkan jumlah pada field FROM, THE SwapPanel SHALL menghitung dan menampilkan estimasi jumlah token TO berdasarkan rate yang berlaku.
2. THE SwapPanel SHALL menampilkan rate konversi dalam format "1 [FROM_TOKEN] = X [TO_TOKEN]".
3. THE SwapPanel SHALL menampilkan persentase price impact untuk setiap quote yang ditampilkan.
4. THE SwapPanel SHALL menampilkan estimasi gas fee dalam satuan yang dapat dibaca pengguna.
5. THE SwapPanel SHALL menampilkan jumlah minimum yang diterima (minimum received) berdasarkan slippage yang dipilih pengguna.
6. WHEN pengguna mengklik tombol "Swap", THE SwapPanel SHALL menampilkan ConfirmationModal yang merangkum detail transaksi sebelum eksekusi.
7. WHEN pengguna mengkonfirmasi di ConfirmationModal, THE SwapPanel SHALL mengeksekusi transaksi swap.
8. IF DEX native tidak tersedia di Arc Testnet, THEN THE SwapPanel SHALL menampilkan UI lengkap dalam disabled state dengan notifikasi "Swap akan tersedia saat mainnet launch".

---

### Requirement 4: Slippage Settings

**User Story:** Sebagai pengguna, saya ingin mengatur toleransi slippage sesuai preferensi saya, sehingga saya dapat mengontrol risiko eksekusi harga yang berbeda dari quote.

#### Acceptance Criteria

1. THE SlippageSettings SHALL dapat diakses melalui ikon ⚙️ di pojok kanan atas SwapPanel.
2. WHEN pengguna mengklik ikon ⚙️, THE SlippageSettings SHALL menampilkan opsi preset: 0.1%, 0.5%, dan 1.0%.
3. THE SlippageSettings SHALL menyediakan input field untuk nilai slippage kustom.
4. WHEN pengguna memilih preset slippage, THE SlippageSettings SHALL menyorot opsi yang dipilih dan memperbarui kalkulasi minimum received.
5. IF pengguna memasukkan nilai slippage lebih dari 5%, THEN THE SlippageSettings SHALL menampilkan pesan peringatan yang terlihat jelas.
6. THE SlippageSettings SHALL menggunakan nilai default 0.5% saat pertama kali dimuat.

---

### Requirement 5: Quote Auto-Refresh

**User Story:** Sebagai pengguna, saya ingin quote diperbarui secara otomatis, sehingga saya selalu melihat harga terkini sebelum melakukan swap.

#### Acceptance Criteria

1. THE QuoteRefresher SHALL memperbarui quote secara otomatis setiap 15 detik.
2. THE QuoteRefresher SHALL menampilkan countdown timer visual yang menghitung mundur dari 15 hingga 0 detik.
3. THE SwapPanel SHALL menyediakan tombol refresh manual yang memungkinkan pengguna memperbarui quote kapan saja.
4. WHEN countdown mencapai 0, THE QuoteRefresher SHALL memperbarui quote dan mereset countdown ke 15 detik.
5. WHEN pengguna mengklik tombol refresh manual, THE QuoteRefresher SHALL segera memperbarui quote dan mereset countdown ke 15 detik.

---

### Requirement 6: Price Impact Indicator

**User Story:** Sebagai pengguna, saya ingin melihat indikator visual dampak harga, sehingga saya dapat menilai risiko swap sebelum mengeksekusinya.

#### Acceptance Criteria

1. WHEN price impact kurang dari 1%, THE PriceImpactIndicator SHALL menampilkan persentase dengan warna hijau dan ikon ✓.
2. WHEN price impact antara 1% dan 3% (inklusif), THE PriceImpactIndicator SHALL menampilkan persentase dengan warna kuning dan ikon ⚠️.
3. WHEN price impact lebih dari 3%, THE PriceImpactIndicator SHALL menampilkan persentase dengan warna merah, ikon ✗, dan teks peringatan tambahan.
4. THE PriceImpactIndicator SHALL memperbarui tampilan secara real-time setiap kali jumlah input atau pasangan token berubah.

---

### Requirement 7: Reverse Button

**User Story:** Sebagai pengguna, saya ingin dapat membalik arah swap dengan satu klik, sehingga saya tidak perlu memilih ulang token secara manual.

#### Acceptance Criteria

1. THE ReverseButton SHALL ditampilkan di tengah antara field FROM dan field TO pada SwapPanel.
2. WHEN pengguna mengklik ReverseButton, THE SwapPanel SHALL menukar posisi token FROM dan TO beserta jumlahnya.
3. WHEN pengguna mengklik ReverseButton, THE SwapPanel SHALL menampilkan animasi transisi yang smooth.
4. WHEN pengguna mengklik ReverseButton saat transaksi sedang diproses, THE ReverseButton SHALL dalam keadaan disabled dan tidak merespons klik.

---

### Requirement 8: Komponen-Komponen Baru

**User Story:** Sebagai developer, saya ingin fitur swap diimplementasikan dalam komponen-komponen yang terpisah dan dapat digunakan kembali, sehingga kode mudah dipelihara dan dikembangkan.

#### Acceptance Criteria

1. THE System SHALL menyediakan file `components/SwapPanel.tsx` sebagai komponen utama swap yang di-upgrade dari versi sebelumnya.
2. THE System SHALL menyediakan file `hooks/useSwapQuote.ts` sebagai custom hook untuk mengambil dan mengelola quote swap.
3. THE System SHALL menyediakan file `hooks/useSwapExecute.ts` sebagai custom hook untuk mengeksekusi transaksi swap.
4. THE System SHALL menyediakan file `components/TokenSelector.tsx` sebagai komponen modal pemilihan token.
5. THE System SHALL menyediakan file `components/SlippageSettings.tsx` sebagai komponen pengaturan slippage.
6. THE System SHALL memperbarui `app/dapp/page.tsx` untuk mengintegrasikan tab Swap sejajar dengan tab Bridge.
7. THE System SHALL memastikan semua komponen baru menggunakan TypeScript dengan type definitions yang eksplisit.
8. THE System SHALL memastikan semua komponen baru kompatibel dengan Next.js 14 App Router dan menggunakan `'use client'` directive di mana diperlukan.

---

### Requirement 9: Styling Konsisten

**User Story:** Sebagai pengguna, saya ingin tampilan tab Swap konsisten dengan design system yang sudah ada, sehingga pengalaman visual terasa menyatu dan profesional.

#### Acceptance Criteria

1. THE SwapPanel SHALL menggunakan border radius `rounded-xl` atau `rounded-2xl` konsisten dengan komponen lain di DApp.
2. THE SwapPanel SHALL menggunakan palet warna zinc (background), emerald (aksen positif), dan sky (aksen interaktif) yang sudah ada.
3. THE SwapPanel SHALL menggunakan border `border-zinc-800` dan background `bg-zinc-900/30` atau `bg-zinc-900/40` konsisten dengan BridgePanel.
4. WHEN tab Swap aktif, THE TabNavigation SHALL menampilkan style yang identik dengan style tab Bridge saat aktif.
5. THE SwapPanel SHALL menampilkan semua elemen interaktif (tombol, input, selector) dengan hover state dan transisi yang konsisten dengan komponen lain.
