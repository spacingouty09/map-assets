// Rail lines and stations of the study area: official line colours, public line numbers and public stop numbers.
// Colours: official KVITS line colours (Wikipedia, "Klang Valley Integrated Transit System" and the line articles,
// fetched 2026-10-10; KLIA Transit #33A8B5 and Skypark #8B4513 from Module:Adjacent stations/KLRT, fetched 2026-10-12).
// KJ = Kelana Jaya, KB = Batu Caves–Pulau Sebang (KTM 1), KD = Tanjung Malim–Port Klang (KTM 2).
export const LINE_COLORS = { lrt: '#e0115f', ktm1: '#3c5a9f', ktm2: '#dc2420', kliaTransit: '#33a8b5', skypark: '#8b4513' } as const;

/** Public line numbers: KTM Komuter 1 / 2, LRT Kelana Jaya 5, KLIA Transit 7, KL Sentral–Terminal Skypark 10 (suspended). */
export const LINE_NUMBERS = { ktm1: 1, ktm2: 2, lrt: 5, kliaTransit: 7, skypark: 10 } as const;

// Public-facing station numbers. Mid Valley (official code KB01) is shown the way riders know it: stop 10 on
// Line 1 counting from Batu Caves (KC05–KC01, KA04–KA01, then Mid Valley; Wikipedia, Batu Caves–Pulau Sebang Line,
// "Stations"). Abdullah Hukum KTM (official KD01) is stop 16 on Line 2 counting from Tanjung Malim (KA15–KA01, then
// Abdullah Hukum), excluding the 2026 Segambut Utara infill (KA05A); owner's choice.
export const PUBLIC_CODE: Record<string, string> = { KB01: '10', KD01: '16' };

/** The public stop number of a station ref (official code when it has none), '—' without a ref. */
export const publicCode = (ref: string | null) => (ref ? PUBLIC_CODE[ref] ?? ref : '—');
