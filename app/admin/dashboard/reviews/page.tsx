"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { collection, documentId, getDocs, orderBy, query, where } from "firebase/firestore"
import { AlertCircle, Loader2, RefreshCw, Search, Star } from "lucide-react"
import { db } from "@/lib/firebase"
import { useAuth } from "@/context/auth-context"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type RatingValue = 1 | 2 | 3 | 4 | 5
type RatingFilterValue = "all" | "1" | "2" | "3" | "4" | "5"

type ReviewRow = {
  id: string
  bookingId: string
  rating: RatingValue | null
  name: string
  comment: string
  email: string
  source: string
  createdAt: Date | null
}

type BookingContext = {
  licensePlate: string
  apiBookingNumber: string
  clientName: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
}

type TimestampLike = { toDate: () => Date }

const PAGE_SIZE = 20

function normalizeText(value: unknown): string {
  return String(value ?? "").trim()
}

function isTimestampLike(value: unknown): value is TimestampLike {
  if (!value || typeof value !== "object") return false
  const maybeTimestamp = value as { toDate?: unknown }
  return typeof maybeTimestamp.toDate === "function"
}

function toDateSafe(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (isTimestampLike(value)) {
    try {
      const parsed = value.toDate()
      return Number.isNaN(parsed.getTime()) ? null : parsed
    } catch {
      return null
    }
  }
  return null
}

function toRating(value: unknown): RatingValue | null {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return null
  if (parsed < 1 || parsed > 5) return null
  return parsed as RatingValue
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items]
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function formatDateTime(value: Date | null): string {
  if (!value) return "-"
  return value.toLocaleString("ro-RO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatCommentPreview(comment: string, maxLength = 90): string {
  if (comment.length <= maxLength) return comment
  return `${comment.slice(0, maxLength)}...`
}

function formatBookingPeriod(context?: BookingContext): string {
  if (!context) return "-"
  const start = context.startDate
    ? `${context.startDate}${context.startTime ? ` ${context.startTime}` : ""}`
    : "-"
  const end = context.endDate ? `${context.endDate}${context.endTime ? ` ${context.endTime}` : ""}` : "-"
  return `${start} -> ${end}`
}

function getRatingBadgeClass(rating: RatingValue): string {
  switch (rating) {
    case 5:
      return "bg-green-100 text-green-800 border-green-200"
    case 4:
      return "bg-lime-100 text-lime-800 border-lime-200"
    case 3:
      return "bg-amber-100 text-amber-800 border-amber-200"
    case 2:
      return "bg-orange-100 text-orange-800 border-orange-200"
    default:
      return "bg-red-100 text-red-800 border-red-200"
  }
}

function toRatingFilterValue(value: string): RatingFilterValue {
  switch (value) {
    case "1":
    case "2":
    case "3":
    case "4":
    case "5":
      return value
    default:
      return "all"
  }
}

export default function ReviewsAdminPage() {
  const { user, loading: authLoading, isAdmin } = useAuth()

  const [reviews, setReviews] = useState<ReviewRow[]>([])
  const [bookingContextMap, setBookingContextMap] = useState<Record<string, BookingContext>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [searchTerm, setSearchTerm] = useState("")
  const [ratingFilter, setRatingFilter] = useState<RatingFilterValue>("all")
  const [currentPage, setCurrentPage] = useState(1)

  const [selectedReview, setSelectedReview] = useState<ReviewRow | null>(null)
  const [isCommentDialogOpen, setIsCommentDialogOpen] = useState(false)

  const loadReviews = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "refresh") {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }
    setError(null)

    try {
      const reviewsRef = collection(db, "reviews")
      const reviewsQuery = query(reviewsRef, orderBy("createdAt", "desc"))
      const reviewsSnap = await getDocs(reviewsQuery)

      const parsedReviews: ReviewRow[] = reviewsSnap.docs.map((reviewDoc) => {
        const raw = reviewDoc.data() as Record<string, unknown>
        const bookingIdFromField = normalizeText(raw.bookingId)
        return {
          id: reviewDoc.id,
          bookingId: bookingIdFromField || reviewDoc.id,
          rating: toRating(raw.rating),
          name: normalizeText(raw.name),
          comment: normalizeText(raw.comment),
          email: normalizeText(raw.email),
          source: normalizeText(raw.source),
          createdAt: toDateSafe(raw.createdAt),
        }
      })

      setReviews(parsedReviews)

      const uniqueBookingIds = Array.from(
        new Set(
          parsedReviews
            .map((row) => row.bookingId)
            .filter((bookingId) => bookingId.length > 0),
        ),
      )

      const nextBookingContextMap: Record<string, BookingContext> = {}
      if (uniqueBookingIds.length > 0) {
        const bookingsRef = collection(db, "bookings")
        const bookingIdChunks = chunkArray(uniqueBookingIds, 10)

        for (const bookingIdsChunk of bookingIdChunks) {
          const bookingsQuery = query(bookingsRef, where(documentId(), "in", bookingIdsChunk))
          const bookingsSnap = await getDocs(bookingsQuery)
          bookingsSnap.forEach((bookingDoc) => {
            const bookingData = bookingDoc.data() as Record<string, unknown>
            nextBookingContextMap[bookingDoc.id] = {
              licensePlate: normalizeText(bookingData.licensePlate),
              apiBookingNumber: normalizeText(bookingData.apiBookingNumber),
              clientName: normalizeText(bookingData.clientName),
              startDate: normalizeText(bookingData.startDate),
              startTime: normalizeText(bookingData.startTime),
              endDate: normalizeText(bookingData.endDate),
              endTime: normalizeText(bookingData.endTime),
            }
          })
        }
      }

      setBookingContextMap(nextBookingContextMap)
    } catch (loadError) {
      console.error("Failed to load admin reviews", loadError)
      setError("Nu am putut încărca recenziile. Reîncearcă.")
      setReviews([])
      setBookingContextMap({})
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    if (!authLoading && user && isAdmin) {
      loadReviews("initial")
      return
    }
    if (!authLoading) {
      setIsLoading(false)
    }
  }, [authLoading, user, isAdmin, loadReviews])

  const ratings = useMemo(
    () => reviews.map((row) => row.rating).filter((rating): rating is RatingValue => rating !== null),
    [reviews],
  )

  const averageRating = useMemo(() => {
    if (ratings.length === 0) return "0.00"
    const average = ratings.reduce((sum, value) => sum + value, 0) / ratings.length
    return average.toFixed(2)
  }, [ratings])

  const fiveStarCount = useMemo(
    () => ratings.filter((rating) => rating === 5).length,
    [ratings],
  )

  const filteredReviews = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()

    return reviews.filter((review) => {
      if (ratingFilter !== "all" && String(review.rating ?? "") !== ratingFilter) {
        return false
      }

      if (!normalizedSearch) return true

      const bookingContext = bookingContextMap[review.bookingId]
      const searchableText = [
        review.name,
        review.email,
        review.bookingId,
        review.comment,
        bookingContext?.licensePlate ?? "",
        bookingContext?.apiBookingNumber ?? "",
      ]
        .join(" ")
        .toLowerCase()

      return searchableText.includes(normalizedSearch)
    })
  }, [reviews, searchTerm, ratingFilter, bookingContextMap])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, ratingFilter])

  const totalPages = Math.max(1, Math.ceil(filteredReviews.length / PAGE_SIZE))

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  const paginatedReviews = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE
    return filteredReviews.slice(startIndex, startIndex + PAGE_SIZE)
  }, [filteredReviews, currentPage])

  const paginationStart = filteredReviews.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const paginationEnd = (currentPage - 1) * PAGE_SIZE + paginatedReviews.length

  const selectedBookingContext = selectedReview ? bookingContextMap[selectedReview.bookingId] : undefined

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-gray-700">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span>Se încarcă recenziile...</span>
      </div>
    )
  }

  if (!user || !isAdmin) {
    return (
      <div className="text-center p-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Acces restricționat</AlertTitle>
          <AlertDescription>Doar conturile admin pot accesa pagina de recenzii.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Recenzii</h1>
          <p className="text-gray-600">Listă read-only cu recenziile trimise de clienți.</p>
        </div>
        <Button
          variant="outline"
          onClick={() => loadReviews("refresh")}
          disabled={isRefreshing}
        >
          {isRefreshing ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Se actualizează...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Actualizează
            </>
          )}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total recenzii</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{reviews.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Rating mediu</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <p className="text-2xl font-bold">{averageRating}</p>
              <Star className="h-5 w-5 text-amber-500 fill-amber-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Recenzii 5 stele</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{fiveStarCount}</p>
          </CardContent>
        </Card>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Eroare la încărcare</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="space-y-4">
          <div>
            <CardTitle>Lista recenzii</CardTitle>
            <CardDescription>
              {filteredReviews.length} afișate din {reviews.length} recenzii.
            </CardDescription>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative w-full">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
              <Input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Caută după nume, email, booking, nr. auto sau comentariu..."
                className="pl-8"
              />
            </div>

            <div className="w-full md:w-[170px]">
              <Select value={ratingFilter} onValueChange={(value) => setRatingFilter(toRatingFilterValue(value))}>
                <SelectTrigger>
                  <SelectValue placeholder="Rating" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toate ratingurile</SelectItem>
                  <SelectItem value="5">5 stele</SelectItem>
                  <SelectItem value="4">4 stele</SelectItem>
                  <SelectItem value="3">3 stele</SelectItem>
                  <SelectItem value="2">2 stele</SelectItem>
                  <SelectItem value="1">1 stea</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dată</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Nume</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Nr. înmatriculare</TableHead>
                <TableHead>Nr. booking API/ID</TableHead>
                <TableHead>Comentariu</TableHead>
                <TableHead>Sursă</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedReviews.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-gray-600">
                    Nu există recenzii.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedReviews.map((review) => {
                  const bookingContext = bookingContextMap[review.bookingId]
                  const bookingDisplay = bookingContext?.apiBookingNumber || review.bookingId || "-"
                  const commentExists = review.comment.length > 0

                  return (
                    <TableRow key={review.id}>
                      <TableCell>{formatDateTime(review.createdAt)}</TableCell>
                      <TableCell>
                        {review.rating ? (
                          <Badge className={getRatingBadgeClass(review.rating)}>
                            <Star className="mr-1 h-3.5 w-3.5 fill-current" />
                            {review.rating}/5
                          </Badge>
                        ) : (
                          <Badge variant="outline">N/A</Badge>
                        )}
                      </TableCell>
                      <TableCell>{review.name || "-"}</TableCell>
                      <TableCell className="text-sm">{review.email || "-"}</TableCell>
                      <TableCell>{bookingContext?.licensePlate || "-"}</TableCell>
                      <TableCell className="font-mono text-xs">{bookingDisplay}</TableCell>
                      <TableCell>
                        {commentExists ? (
                          <div className="max-w-[320px]">
                            <p className="text-sm text-gray-700 break-words">
                              {formatCommentPreview(review.comment)}
                            </p>
                            <Button
                              type="button"
                              variant="link"
                              size="sm"
                              className="h-auto p-0 mt-1"
                              onClick={() => {
                                setSelectedReview(review)
                                setIsCommentDialogOpen(true)
                              }}
                            >
                              Vezi
                            </Button>
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell>{review.source || "-"}</TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm text-gray-600">
            <p>
              Afișezi {paginationStart}-{paginationEnd} din {filteredReviews.length}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage === 1}
              >
                Anterioară
              </Button>
              <span>
                Pagina {currentPage} / {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={currentPage === totalPages}
              >
                Următoare
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={isCommentDialogOpen}
        onOpenChange={(open) => {
          setIsCommentDialogOpen(open)
          if (!open) setSelectedReview(null)
        }}
      >
        <DialogContent className="sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle>Comentariu recenzie</DialogTitle>
            <DialogDescription>
              {selectedReview ? `Booking: ${selectedReview.bookingId}` : "Detalii recenzie"}
            </DialogDescription>
          </DialogHeader>

          {selectedReview ? (
            <div className="space-y-3 text-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                <p>
                  <strong>Nume:</strong> {selectedReview.name || "-"}
                </p>
                <p>
                  <strong>Email:</strong> {selectedReview.email || "-"}
                </p>
                <p>
                  <strong>Rating:</strong> {selectedReview.rating ? `${selectedReview.rating}/5` : "-"}
                </p>
                <p>
                  <strong>Dată:</strong> {formatDateTime(selectedReview.createdAt)}
                </p>
                <p>
                  <strong>Nr. înmatriculare:</strong> {selectedBookingContext?.licensePlate || "-"}
                </p>
                <p>
                  <strong>Nr. booking API/ID:</strong>{" "}
                  {selectedBookingContext?.apiBookingNumber || selectedReview.bookingId || "-"}
                </p>
                <p className="sm:col-span-2">
                  <strong>Perioadă rezervare:</strong> {formatBookingPeriod(selectedBookingContext)}
                </p>
              </div>

              <div className="rounded-md border bg-gray-50 p-3 whitespace-pre-wrap break-words text-gray-800">
                {selectedReview.comment || "-"}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
