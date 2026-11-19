# Wildcat-CDC serial protocol

USB CDC-ACM (115200 8N1 values are ignored). ASCII lines terminated by `\n` (`\r` ignored), case-insensitive,
tokens separated by spaces, max 63 chars per line. Replies end with `\n`. Setters reply `OK`; errors reply `ERR <reason>`.
Unknown command: `ERR unknown`. Wrong token count: `ERR args`. Line too long: `ERR overflow`.

Source: `UsbCmd.c` (parsed from the main loop right after `Synchro()`), `UsbCdc.c` (transport).

## Commands

| Command | Reply | Maps to | Valid range |
|---|---|---|---|
| `*IDN?` | `DS203,Wildcat-CDC,6.5-cdc1` | | |
| `CH <A\|B> RANGE <n>` | `OK` | `Title[TRACK1/2][RANGE]` -> `Update_Range()` | 0..`Limit` (BIOS `Yp_Max`, see `TABLES?`) else `ERR range` |
| `CH <A\|B> OFFSET <n>` | `OK` | `Title[TRACK1/2][POSI]` -> `SetOffset()` via `Update_Range()` | 0..200 (screen pixels, 25 px/div, default A=150 B=100) |
| `CH <A\|B> COUPLE <AC\|DC>` | `OK` | `Title[TRACK1/2][COUPLE]` 1=AC, 0=DC | |
| `TB <n>` | `OK` | `_T_base` (`Title[T_BASE][BASE]`) -> `Update_Base()` | 0..`Limit` (21); `ERR mode` in SCAN / X_Y |
| `MODE <n>` | `OK` | `_Mode` (extra, not in the original spec) | 1..5 (see table); `ERR mode` if currently SCAN/X_Y or value 0/6 |
| `TRIG SRC <A\|B\|C\|D>` | `OK` | `Title[TRIGG][SOURCE]` 0..3 -> `Update_Trig()` | `ERR channel off` if that track is hidden; `ERR ab mode` if the scope is in A&B trigger mode |
| `TRIG KIND <n>` | `OK` | `_Tr_kind` | 0..8 |
| `TRIG LEVEL <n>` | `OK` | `V_Trigg[_Tr_source].Value` | 0..200 (screen pixels, same scale as OFFSET); `ERR source` if source is C/D |
| `RUN` | `OK` | `_Status = RUN`, clears FIFO/buffer like the KEY1 handler | no-op if already running |
| `STOP` | `OK` | `_Status = HOLD` | |
| `STATE?` | one line, see below | | |
| `TABLES?` | `TABLES V=<range names> T=<timebase names>` | `Y_Attr[i].STR`, `X_Attr[i].STR` from the BIOS | |
| `DIAG?` | `DIAG ISR=.. RST=.. SUSP=.. WKUP=.. ERR=.. FIX=.. ISTR=.. CNTR=.. ADDR=.. CFG=..` | `UsbCdc_Diag()`: USB ISR entries, bus resets, suspend/wakeup/error flags seen, CNTR self-repairs, last ISTR, CNTR, DADDR (all decimal, u16 counters wrap), CFG=1 when configured | |
| `CAP?` | `#CAP <n> 2\n` + 2n raw bytes + `\nOK\n` | `DataBuf` | |
| `CAPD?` | `#CAP <n> 3\n` + 3n raw bytes + `\nOK\n` | `DataBuf` | |

Every setter sets the Title `Flag |= UPDAT` and `Update = 1` with `SelectiveUpdate` masking out the `Update_*` calls that
change does not need (same masks the key handler uses), so the LCD menu follows. The signal generator is never touched.

### STATE?

`STATE RA=5 RB=1 OA=150 OB=100 CA=0 CB=1 SA=1 SB=1 TB=17 MODE=1 TSRC=1 TKIND=0 TLEVEL=100 RUN=1 N=4096 AO=54`

RA/RB range idx, OA/OB offset, CA/CB couple (0 DC, 1 AC, other values = detector/serial modes set from the menu),
SA/SB channel source (0 = channel off), TB timebase idx, MODE, TSRC/TKIND/TLEVEL trigger, RUN=1 running / 0 hold,
N = samples a CAP? would return now (`get_bag_max_buf()`), AO = `ADCoffset`.

### CAP? / CAPD? frame

`#CAP <n> <bps>\n`, then `n` samples, then `\nOK\n`. Per sample: byte0 = ChA (bits 0-7 of the `DataBuf` word),
byte1 = ChB (bits 8-15); with `CAPD?` byte2 = bits 16-17 (bit0 = C, bit1 = D). Raw ADC codes, not volts.
Ground of channel X is at code `AO + OFFSET(X)` (calibration terms Ka1/Ka2 not applied); volts ~ `(code - AO - OFFSET) / 25 * volts_per_div`.
The trigger point is at sample index ~150 (149 for time-based trigger kinds).
In oversampling buffer modes (`_T_base < 17` with OS enabled) bits 16-31 of the word hold OS min/max, so `CAPD?` is meaningless there.

Readiness: if the scope is in HOLD the current buffer is sent immediately. If running, the reply waits for the next
completed frame (`FrameEndFlag` consumed by `Draw_Window`, counted in `UsbFrameCnt`) for up to 500 ms, else `ERR timeout`
(typical with NORM/SGL modes and no trigger). Use AUTO mode (`MODE 1`) for free-running capture.
Writes retry until the host drains the TX ring; if nothing drains for 1 s the rest of the reply is dropped.

## Index tables

### Timebase `TB` (`TimeBase[]` in Process.c, `FPGA_TbaseOS[]` comments, `_100uS = 12` in Calibrat.h)

| idx | time/div | idx | time/div | idx | time/div | idx | time/div |
|---|---|---|---|---|---|---|---|
| 0 | 1 s | 6 | 10 ms | 12 | 100 us | 18 | 1 us |
| 1 | 500 ms | 7 | 5 ms | 13 | 50 us | 19 | 0.5 us |
| 2 | 200 ms | 8 | 2 ms | 14 | 20 us | 20 | 0.2 us |
| 3 | 100 ms | 9 | 1 ms | 15 | 10 us | 21 | 0.1 us |
| 4 | 50 ms | 10 | 500 us | 16 | 5 us | | |
| 5 | 20 ms | 11 | 200 us | 17 | 2 us (menu default) | | |

Sample rate is not tabulated in the app: it comes from the BIOS `X_Attr[idx].PSC/ARR/KP`
(period = (PSC+1)(ARR+1)/72 MHz, see Draw.c `SamplingPeriod`). Nominal density is 25 samples/div; the fastest ranges
(roughly idx 17-21) are interpolated (`KP` < 1024). Exact MS/s per index is NOT confirmed from source; measure with a known
signal or read the strings with `TABLES?`.

### Vertical `RANGE`

The strings live in the BIOS (`Y_Attr[i].STR`, loaded into `Vertical[]` by `Load_Attr`), not in the app sources, so volts/div per
index is NOT confirmed here. Use `TABLES?` (`V=` list, index = position). The app defaults are A=5, B=1.

### Other enums

- `MODE`: 0 SCAN (roll), 1 AUTO, 2 NORM (`NORH`), 3 NORM-CL (`NORC`), 4 PERSIST (`NORHLD`), 5 SINGLE (`SGL`), 6 X_Y. Only 1..5 are accepted.
- `TRIG KIND` (`TR_TYPE`): 0 falling edge, 1 rising edge, 2 `<Vt`, 3 `>Vt`, 4 `L<[`, 5 `L>[`, 6 `H<[`, 7 `H>[` (pulse width vs T1-T2 cursors), 8 GEN (only meaningful with the generator in sweep/burst).
- `TRIG SRC`: A=0, B=1, C=2, D=3 (4 = A&B alternate, not settable here).
- `COUPLE` on screen also has DT/TL/RS/i2/SP for detector and serial decode; only AC/DC are settable.

## Not confidently mapped / caveats

- Volts/div and MS/s per index (above): need `TABLES?` or hardware measurement.
- `MODE` is an addition beyond the requested list; it only flips `_Mode` + full update, without the menu's per-mode side effects (NORHLD buffer clears, A&B juggling).
- Slow timebases (`TB` 0..10) fill `DataBuf` incrementally (`JumpCnt`); in HOLD the buffer may be partly refreshed. For a coherent frame at those speeds, prefer a fast timebase or let `CAP?` wait for a frame while running.
- `RUN` re-implements the common branch of the KEY1 handler (not the Options/FrameMode special cases).
- `TRIG SRC C|D` is accepted when the track is on but not exercised by the menu code path the same way (digital trigger memory `PreviousTrigSelect` is not updated).
- CH range/offset changes do not move the trigger level; re-set `TRIG LEVEL` afterwards.

## Test plan

1. Flash `app1-cdc.hex`, connect, `python3 ds203.py <port> idn` -> `DS203,Wildcat-CDC,6.5-cdc1`.
2. `state`, compare each field with the LCD menu; `set TABLES?` lists range/timebase names.
3. Feed a known square wave (CAL pin, 1 kHz). `set MODE 1`, `set TB 9`, `set CH A RANGE n` and verify LCD title fields change in step and the waveform fits.
4. `set TRIG SRC A`, `set TRIG KIND 1`, `set TRIG LEVEL 150`, check LCD trigger marker moves and NORM mode (`MODE 2`) triggers.
5. `cap a.csv` while running, then `stop`, `cap b.csv`, `cap --digital`; check n matches `STATE? N`, header/trailer parse, CSV plots as the expected wave, rising edge near idx 150.
6. Negative tests: `CH C RANGE 1`, `CH A RANGE 99`, `TB 22`, `FOO`, 70-char line, `CAP?` with no trigger in NORM (expect `ERR timeout`).
7. Close the host port mid-`CAP?` and confirm the scope keeps running (1 s watchdog), then reopen and re-run.
8. Press buttons on the scope during a session; menu and serial changes must not desync.
