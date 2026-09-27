import base64
import sys
from pathlib import Path

for index in range(1, 41):
    image = base64.b64encode(Path(f'/tmp/stress40/img_{index:02}.png').read_bytes()).decode()
    sys.stdout.write(f'IMAGE {index} - stationary, no repaint loop\r\n')
    sys.stdout.write('\r\n' * 12 + '\x1b[12A')
    for offset in range(0, len(image), 4096):
        chunk = image[offset:offset + 4096]
        more = int(offset + 4096 < len(image))
        header = f'a=t,f=100,q=2,i={7700 + index},m={more}' if offset == 0 else f'm={more}'
        sys.stdout.write(f'\x1b_G{header};{chunk}\x1b\\')
    sys.stdout.write(f'\x1b_Ga=p,q=2,C=1,i={7700 + index},p=1,c=50,r=12\x1b\\')
    sys.stdout.write('\x1b[12B')
sys.stdout.write('IMAGE FIXTURE COMPLETE\r\n')
sys.stdout.flush()
