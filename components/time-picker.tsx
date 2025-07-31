"use client"

import type * as React from "react"
import { Clock, ChevronUp, ChevronDown } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

interface TimePickerDemoProps {
  value: string
  onChange: (time: string) => void
}

export function TimePickerDemo({ value, onChange }: TimePickerDemoProps) {
  const [hours, minutes] = value.split(":").map(Number)

  const handleHoursChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newHours = Number.parseInt(e.target.value)
    if (isNaN(newHours) || newHours < 0 || newHours > 23) return
    onChange(`${newHours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`)
  }

  const handleMinutesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newMinutes = Number.parseInt(e.target.value)
    if (isNaN(newMinutes) || newMinutes < 0 || newMinutes > 59) return
    onChange(`${hours.toString().padStart(2, "0")}:${newMinutes.toString().padStart(2, "0")}`)
  }

  const incrementHours = () => {
    const newHours = (hours + 1) % 24
    onChange(`${newHours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`)
  }

  const decrementHours = () => {
    const newHours = (hours - 1 + 24) % 24
    onChange(`${newHours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`)
  }

  const incrementMinutes = () => {
    const newMinutes = (minutes + 5) % 60
    onChange(`${hours.toString().padStart(2, "0")}:${newMinutes.toString().padStart(2, "0")}`)
  }

  const decrementMinutes = () => {
    const newMinutes = (minutes - 5 + 60) % 60
    onChange(`${hours.toString().padStart(2, "0")}:${newMinutes.toString().padStart(2, "0")}`)
  }

  return (
    <div className="flex items-center space-x-2">
      <div className="grid gap-1 text-center">
        <Label htmlFor="hours" className="text-xs">
          Ore
        </Label>
        <div className="flex flex-col items-center">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 hover:bg-transparent"
            onClick={incrementHours}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
        <Input
          id="hours"
            className="w-16 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          value={hours.toString().padStart(2, "0")}
          onChange={handleHoursChange}
          type="number"
          min={0}
          max={23}
            inputMode="numeric"
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 hover:bg-transparent"
            onClick={decrementHours}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="grid gap-1 text-center">
        <Label htmlFor="minutes" className="text-xs">
          Minute
        </Label>
        <div className="flex flex-col items-center">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 hover:bg-transparent"
            onClick={incrementMinutes}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
        <Input
          id="minutes"
            className="w-16 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          value={minutes.toString().padStart(2, "0")}
          onChange={handleMinutesChange}
          type="number"
          min={0}
          max={59}
          step={5}
            inputMode="numeric"
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 hover:bg-transparent"
            onClick={decrementMinutes}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="flex h-10 items-center justify-center">
        <Clock className="h-4 w-4 text-muted-foreground" />
      </div>
    </div>
  )
}
