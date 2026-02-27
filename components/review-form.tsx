"use client";

import { useState } from "react";
import type { FormEvent } from "react";

type ReviewFormProps = {
  bookingId: string;
};

const GOOGLE_REVIEW_URL = "https://g.page/r/CWWqOp4BhgTkEAE/review";

export default function ReviewForm({ bookingId }: ReviewFormProps) {
  const [rating, setRating] = useState(5);
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bookingId,
          rating,
          name: name.trim() || undefined,
          comment: comment.trim() || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        setError(data?.error || "Nu am putut trimite recenzia.");
        return;
      }
      setSuccess("Multumim! Recenzia ta a fost trimisa.");
    } catch (_err) {
      setError("A aparut o eroare la trimitere. Incearca din nou.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold mb-2">Lasa o recenzie</h1>
      <p className="text-sm text-gray-600 mb-6">
        Dupa trimitere, poti lasa si o recenzie publica pe Google.
      </p>

      {success ? (
        <div className="rounded-md border border-green-200 bg-green-50 p-4 text-green-800 space-y-4">
          <p>{success}</p>
          <div>
            <a
              href={GOOGLE_REVIEW_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-md border border-green-700 bg-white px-4 py-2 text-sm font-semibold text-green-800 hover:bg-green-100"
            >
              Lasa si pe Google
            </a>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2">Rating</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRating(value)}
                  className={`h-10 w-10 rounded-md border text-sm font-semibold ${
                    rating === value
                      ? "border-orange-500 bg-orange-100 text-orange-700"
                      : "border-gray-300 bg-white text-gray-700"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="name" className="block text-sm font-medium mb-2">
              Nume (optional)
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="Ex: Andrei I."
            />
          </div>

          <div>
            <label htmlFor="comment" className="block text-sm font-medium mb-2">
              Comentariu (optional)
            </label>
            <textarea
              id="comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={1000}
              rows={5}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="Spune-ne pe scurt cum a fost experienta."
            />
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-orange-500 px-4 py-2 text-white disabled:opacity-60"
          >
            {isSubmitting ? "Se trimite..." : "Trimite recenzia"}
          </button>
        </form>
      )}
    </div>
  );
}
