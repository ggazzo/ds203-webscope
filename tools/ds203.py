#!/usr/bin/env python3
"""DS203 Wildcat-CDC client (stdlib only).

  ds203.py <port> idn | state | run | stop
  ds203.py <port> set <command words...>     e.g. set CH A RANGE 4 | set TB 17 | set TRIG LEVEL 120
  ds203.py <port> cap <out.csv> [--digital]  CAP? (or CAPD?) -> CSV idx,chA,chB[,dig]
"""
import os
import sys
import termios
import time


def open_port(path):
    fd = os.open(path, os.O_RDWR | os.O_NOCTTY)
    a = termios.tcgetattr(fd)
    a[0] = 0                                    # iflag
    a[1] = 0                                    # oflag
    a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
    a[3] = 0                                    # lflag: raw
    a[4] = a[5] = termios.B115200               # ignored by CDC, but must be valid
    a[6][termios.VMIN] = 0
    a[6][termios.VTIME] = 1                     # 100 ms read timeout
    termios.tcsetattr(fd, termios.TCSANOW, a)
    termios.tcflush(fd, termios.TCIOFLUSH)
    return fd


def read_exact(fd, n, timeout):
    buf = b""
    end = time.monotonic() + timeout
    while len(buf) < n:
        if time.monotonic() > end:
            raise TimeoutError("timed out after %d of %d bytes" % (len(buf), n))
        buf += os.read(fd, n - len(buf))
    return buf


def read_line(fd, timeout=2.0):
    buf = b""
    end = time.monotonic() + timeout
    while not buf.endswith(b"\n"):
        if time.monotonic() > end:
            raise TimeoutError("no reply (got %r)" % buf)
        buf += os.read(fd, 1)
    return buf.decode("ascii", "replace").strip()


def send(fd, cmd):
    os.write(fd, cmd.encode("ascii") + b"\n")


def ask(fd, cmd, timeout=2.0):
    send(fd, cmd)
    return read_line(fd, timeout)


def capture(fd, out, digital):
    send(fd, "CAPD?" if digital else "CAP?")
    hdr = read_line(fd, 2.0)             # firmware waits up to 500 ms for a frame
    if not hdr.startswith("#CAP "):
        raise RuntimeError(hdr)
    _, n, bps = hdr.split()
    n, bps = int(n), int(bps)
    data = read_exact(fd, n * bps, 5.0)
    tail = read_exact(fd, 4, 2.0)
    if tail != b"\nOK\n":
        raise RuntimeError("bad frame trailer %r" % tail)
    with open(out, "w") as f:
        f.write("idx,chA,chB" + (",dig" if bps == 3 else "") + "\n")
        for i in range(n):
            f.write(",".join([str(i)] + [str(b) for b in data[i * bps:(i + 1) * bps]]) + "\n")
    print("wrote %d samples to %s" % (n, out))


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    port, verb, rest = argv[1], argv[2].lower(), argv[3:]
    fd = open_port(port)
    try:
        if verb == "idn":
            print(ask(fd, "*IDN?"))
        elif verb == "state":
            print(ask(fd, "STATE?"))
        elif verb in ("run", "stop"):
            print(ask(fd, verb.upper()))
        elif verb == "set" and rest:
            print(ask(fd, " ".join(rest)))
        elif verb == "cap" and rest:
            capture(fd, rest[0], "--digital" in rest[1:])
        else:
            print(__doc__)
            return 2
    except (TimeoutError, RuntimeError) as e:
        print("error:", e, file=sys.stderr)
        return 1
    finally:
        os.close(fd)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
