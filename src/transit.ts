// Rail lines and stations of the study area: official line colours, public line numbers and public stop numbers.
// Colours: official KVITS line colours (Wikipedia, "Klang Valley Integrated Transit System" and the line articles,
// fetched 2026-10-10; KLIA Transit #33A8B5, Skypark #8B4513, Putrajaya #FACA05 and KL Monorail #7DBA00 from
// Module:Adjacent stations/KLRT, fetched 2026-10-12, which also gives Kelana Jaya as #E0115F).
// KJ = Kelana Jaya, KB = Batu Caves–Pulau Sebang (KTM 1), KD = Tanjung Malim–Port Klang (KTM 2), PY = Putrajaya, MR = KL Monorail.
export const LINE_COLORS = { lrt: '#e0115f', ktm1: '#3c5a9f', ktm2: '#dc2420', kliaTransit: '#33a8b5', skypark: '#8b4513', py: '#faca05', mr: '#7dba00' } as const;

/** Public line numbers: KTM Komuter 1 / 2, LRT Kelana Jaya 5, KLIA Transit 7, KL Monorail 8, KL Sentral–Terminal Skypark 10
 *  (suspended), MRT Putrajaya 12 (Wikipedia, "Putrajaya line": "numbered 12 and coloured yellow", fetched 2026-10-12). */
export const LINE_NUMBERS = { ktm1: 1, ktm2: 2, lrt: 5, kliaTransit: 7, mr: 8, skypark: 10, py: 12 } as const;

// Public-facing station numbers. Mid Valley (official code KB01) is shown the way riders know it: stop 10 on
// Line 1 counting from Batu Caves (KC05–KC01, KA04–KA01, then Mid Valley; Wikipedia, Batu Caves–Pulau Sebang Line,
// "Stations"). Abdullah Hukum KTM (official KD01) is stop 16 on Line 2 counting from Tanjung Malim (KA15–KA01, then
// Abdullah Hukum), excluding the 2026 Segambut Utara infill (KA05A); owner's choice.
export const PUBLIC_CODE: Record<string, string> = { KB01: '10', KD01: '16' };

/** The public stop number of a station ref (official code when it has none), '—' without a ref. */
export const publicCode = (ref: string | null) => (ref ? PUBLIC_CODE[ref] ?? ref : '—');
