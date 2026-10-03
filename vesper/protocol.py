"""VESPER wire protocol v1. All numeric fields are little endian.

The bounded streaming decoder tolerates boot logs, partial reads, corrupted
packets, and a cable pulled in the middle of a frame. See docs/PROTOCOL.md.
"""
import enum
import struct
from dataclasses import dataclass

MAGIC = b"V9"
VERSION = 1
MAX_PAYLOAD = 768
HEADER = struct.Struct("<2sBBHH")


class Kind(enum.IntEnum):
    HELLO = 1
    BUTTON = 2
    SENSOR = 3
    AUDIO = 4
    CUE = 5
    KNOCK_CLIP = 10
    STATUS = 6
    ACK = 7
    KNOCK = 8
    PING = 16
    LEDS = 17
    MIC = 18
    ARM = 19
    CANCEL = 20
    PATTERN = 21
    KNOCK_SET = 22


def crc16(data):
    crc = 0xFFFF
    for value in data:
        crc ^= value << 8
        for _ in range(8):
            crc = ((crc << 1) ^ (0x1021 if crc & 0x8000 else 0)) & 0xFFFF
    return crc


def encode(kind, payload=b"", sequence=0):
    if len(payload) > MAX_PAYLOAD:
        raise ValueError("payload too large")
    frame = HEADER.pack(MAGIC, VERSION, int(kind), sequence & 0xFFFF, len(payload)) + payload
    return frame + struct.pack("<H", crc16(frame[2:]))


@dataclass(frozen=True)
class Packet:
    kind: int
    sequence: int
    payload: bytes


class Decoder:
    def __init__(self):
        self.buffer = bytearray()
        self.errors = 0
        self.discarded = 0

    def feed(self, data):
        self.buffer.extend(data)
        packets = []
        while True:
            start = self.buffer.find(MAGIC)
            if start < 0:
                keep = 1 if self.buffer.endswith(MAGIC[:1]) else 0
                self.discarded += len(self.buffer) - keep
                self.buffer[:] = self.buffer[-1:] if keep else b""
                break
            if start:
                self.discarded += start
                del self.buffer[:start]
            if len(self.buffer) < HEADER.size:
                break
            _, version, kind, sequence, length = HEADER.unpack_from(self.buffer)
            if version != VERSION or length > MAX_PAYLOAD:
                self.errors += 1
                del self.buffer[0]
                continue
            size = HEADER.size + length + 2
            if len(self.buffer) < size:
                break
            expected = struct.unpack_from("<H", self.buffer, size - 2)[0]
            if crc16(self.buffer[2:size - 2]) != expected:
                self.errors += 1
                del self.buffer[0]
                continue
            packets.append(Packet(kind, sequence, bytes(self.buffer[8:size - 2])))
            del self.buffer[:size]
        return packets
