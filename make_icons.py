"""Generate the app icons: mowed-lawn stripes with a red mower."""
import struct, zlib

def write_png(path, size):
    px = bytearray(size * size * 4)
    light, dark, ink, red, grey = (143, 208, 103), (93, 158, 65), (29, 29, 29), (217, 74, 58), (74, 74, 74)
    stripe = size / 6
    mx0, mx1, my0, my1 = size * 0.30, size * 0.70, size * 0.34, size * 0.66
    rim = max(2, size * 0.03)
    for y in range(size):
        for x in range(size):
            c = light if int(x / stripe) % 2 == 0 else dark
            if mx0 - rim <= x <= mx1 + rim and my0 - rim <= y <= my1 + rim:
                c = ink
                if mx0 <= x <= mx1 and my0 <= y <= my1:
                    c = red
                    dx, dy = x - size * 0.5, y - size * 0.5
                    if dx * dx + dy * dy < (size * 0.09) ** 2:
                        c = grey
            i = (y * size + x) * 4
            px[i:i + 4] = bytes((c[0], c[1], c[2], 255))

    def chunk(name, data):
        return struct.pack('>I', len(data)) + name + data + struct.pack('>I', zlib.crc32(name + data) & 0xffffffff)
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        raw.extend(px[y * size * 4:(y + 1) * size * 4])
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b''))
    print(f"Written {path}")

write_png('icons/icon-192.png', 192)
write_png('icons/icon-512.png', 512)
