export function seriesPath(year: string, search = '', seriesId?: number): string {
  return seriesId && seriesId > 0
    ? '/mathcenter/' + year + '/series/' + seriesId + '/progress' + search
    : '/mathcenter/' + year + '/series' + search
}

export function coffinsQueuePath(year: string, search = ''): string {
  return '/mathcenter/' + year + '/coffins/queue' + search
}

export function coffinQueueThreadPath(year: string, seriesId: number, threadId: number, search = ''): string {
  return '/mathcenter/' + year + '/coffins/queue/' + seriesId + '/thread/' + threadId + search
}

export function threadBackPath(
  year: string,
  origin: 'series' | 'coffins',
  search = '',
  seriesId?: number,
): string {
  return origin === 'coffins'
    ? coffinsQueuePath(year, search)
    : seriesPath(year, search, seriesId)
}
