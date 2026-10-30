def thin(line, step):  # Drop points closer than `step` (Manhattan) to the last one kept
    out = [line[0]]
    for pt in line[1:]:
        if abs(pt[0] - out[-1][0]) + abs(pt[1] - out[-1][1]) > step:
            out.append(pt)
    return out + ([line[-1]] if out[-1] != line[-1] else [])

def rdp(line, eps):  # Drop points that move the line less than `eps` (Douglas-Peucker)
    if len(line) < 3:
        return line
    keep, stack = {0, len(line) - 1}, [(0, len(line) - 1)]
    while stack:
        i, j = stack.pop()
        (x1, y1), (x2, y2) = line[i], line[j]
        dx, dy = x2 - x1, y2 - y1
        norm = (dx * dx + dy * dy) ** .5
        far, k = 0, None
        for n in range(i + 1, j):
            px, py = line[n]
            d = abs(dy * px - dx * py + x2 * y1 - y2 * x1) / norm if norm else ((px - x1) ** 2 + (py - y1) ** 2) ** .5
            if d > far:
                far, k = d, n
        if k is not None and far > eps:
            keep.add(k)
            stack += [(i, k), (k, j)]
    return [line[n] for n in sorted(keep)]
