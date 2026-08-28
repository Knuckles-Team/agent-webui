// Complexity-gate plant harness for WD4-WEB-00's proof that
// check_complexity_staged.py refuses a known-bad .ts input. Temporary --
// removed by the end of this branch's history; see the lane report for the
// five-case table this file was built to exercise.

export function preExisting(x: number): number {
  let total = 0
  if (x === 1) total += 1
  else if (x === 2) total += 2
  else if (x === 3) total += 3
  else if (x === 4) total += 4
  else if (x === 5) total += 5
  else if (x === 6) total += 6
  else if (x === 7) total += 7
  else if (x === 8) total += 8
  else if (x === 9) total += 9
  else if (x === 10) total += 10
  else if (x === 11) total += 11
  else total += 0
  return total
}

export function regressable(x: number, y: number, z: number): number {
  let total = 0
  if (x > 0) {
    if (y > 0) {
      if (z > 0) {
        total += 1
      } else if (z < 0) {
        total += 2
      } else {
        total += 6
      }
    } else if (y < 0) {
      total += 3
    }
  } else if (x < 0) {
    if (y > 0) {
      total += 4
    } else if (y < 0) {
      total += 5
    }
  }
  return total
}
