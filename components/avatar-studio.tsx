'use client'

import { useEffect, useState, type ChangeEvent } from 'react'
import { upload } from '@vercel/blob/client'
import Cropper, { type Area, type Point } from 'react-easy-crop'
import { useRouter } from 'next/navigation'
import { Check, ImagePlus, RotateCcw, RotateCw, X } from 'lucide-react'
import { discardMediaUploadsAction, updateAvatarDecorationAction, updateProfileBannerAction, updateProfilePhotoAction } from '@/app/actions/chat'
import type { AvatarDecoration, ChatUser } from '@/lib/chat-types'
import { MAX_PROFILE_BANNER_BYTES, MAX_PROFILE_PHOTO_BYTES, mediaUrl, PROFILE_PHOTO_TYPES } from '@/lib/media'

type CropTarget = 'avatar' | 'banner'
type PhotoFilter = 'original' | 'warm' | 'mono'

const photoFilters: Array<{ id: PhotoFilter; label: string; css: string }> = [
  { id: 'original', label: 'Original', css: 'none' },
  { id: 'warm', label: 'Warm film', css: 'sepia(.18) saturate(1.15) contrast(1.04)' },
  { id: 'mono', label: 'Black & white', css: 'grayscale(1) contrast(1.08)' },
]

const decorations: Array<{ id: AvatarDecoration; label: string; description: string }> = [
  { id: 'minimal', label: 'Classic', description: 'Clean and simple' },
  { id: 'square', label: 'Soft square', description: 'Rounded corners' },
  { id: 'halo', label: 'Halo', description: 'A bright profile ring' },
  { id: 'orbit', label: 'Orbit', description: 'A moving accent ring' },
  { id: 'spark', label: 'Glow', description: 'A soft luminous edge' },
]

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = source
  })
}

async function createCroppedImage(
  source: string,
  area: Area,
  rotation: number,
  flipped: boolean,
  filter: PhotoFilter,
  target: CropTarget,
) {
  const image = await loadImage(source)
  const radians = (rotation * Math.PI) / 180
  const rotatedWidth = Math.ceil(Math.abs(image.naturalWidth * Math.cos(radians)) + Math.abs(image.naturalHeight * Math.sin(radians)))
  const rotatedHeight = Math.ceil(Math.abs(image.naturalWidth * Math.sin(radians)) + Math.abs(image.naturalHeight * Math.cos(radians)))
  const rotatedCanvas = document.createElement('canvas')
  rotatedCanvas.width = rotatedWidth
  rotatedCanvas.height = rotatedHeight
  const rotatedContext = rotatedCanvas.getContext('2d')
  if (!rotatedContext) throw new Error('Image editing is unavailable in this browser.')

  rotatedContext.translate(rotatedWidth / 2, rotatedHeight / 2)
  rotatedContext.rotate(radians)
  rotatedContext.scale(flipped ? -1 : 1, 1)
  rotatedContext.filter = photoFilters.find((item) => item.id === filter)?.css ?? 'none'
  rotatedContext.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2)

  const outputScale = Math.min(1, (target === 'banner' ? 1800 : 900) / area.width)
  const outputWidth = Math.max(1, Math.round(area.width * outputScale))
  const outputHeight = Math.max(1, Math.round(area.height * outputScale))
  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = outputWidth
  outputCanvas.height = outputHeight
  const outputContext = outputCanvas.getContext('2d')
  if (!outputContext) throw new Error('Image editing is unavailable in this browser.')
  outputContext.drawImage(rotatedCanvas, area.x, area.y, area.width, area.height, 0, 0, outputWidth, outputHeight)

  return new Promise<Blob>((resolve, reject) => {
    outputCanvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The edited image could not be prepared.')), 'image/webp', 0.9)
  })
}

export function AvatarStudio({
  user,
  name,
  username,
  about,
  image,
  bannerImage,
  avatarDecoration,
  onImageChange,
  onBannerChange,
  onDecorationChange,
  onStatus,
}: {
  user: ChatUser
  name: string
  username: string
  about: string
  image: string | null
  bannerImage: string | null
  avatarDecoration: AvatarDecoration
  onImageChange: (image: string) => void
  onBannerChange: (image: string) => void
  onDecorationChange: (decoration: AvatarDecoration) => void
  onStatus: (message: string, isError?: boolean) => void
}) {
  const router = useRouter()
  const [target, setTarget] = useState<CropTarget>('avatar')
  const [source, setSource] = useState<string | null>(null)
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [filter, setFilter] = useState<PhotoFilter>('original')
  const [cropArea, setCropArea] = useState<Area | null>(null)
  const [saving, setSaving] = useState(false)
  const [styleSaving, setStyleSaving] = useState(false)

  useEffect(() => {
    if (!source) return
    return () => URL.revokeObjectURL(source)
  }, [source])

  function chooseImage(nextTarget: CropTarget, event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return

    const maximumSize = nextTarget === 'banner' ? MAX_PROFILE_BANNER_BYTES : MAX_PROFILE_PHOTO_BYTES
    if (!PROFILE_PHOTO_TYPES.includes(file.type as typeof PROFILE_PHOTO_TYPES[number]) || file.size > maximumSize) {
      onStatus(`Choose a JPG, PNG, WebP, or GIF image up to ${nextTarget === 'banner' ? '8' : '5'} MB.`, true)
      return
    }

    onStatus('')
    setTarget(nextTarget)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setRotation(0)
    setFlipped(false)
    setFilter('original')
    setCropArea(null)
    setSource(URL.createObjectURL(file))
  }

  async function saveDecoration(decoration: AvatarDecoration) {
    setStyleSaving(true)
    onStatus('')
    try {
      await updateAvatarDecorationAction(decoration)
      onDecorationChange(decoration)
      onStatus('Avatar style saved.')
      router.refresh()
    } catch {
      onStatus('Avatar style could not be saved. Please try again.', true)
    } finally {
      setStyleSaving(false)
    }
  }

  async function saveCrop() {
    if (!source || !cropArea || saving) return
    setSaving(true)
    onStatus('')
    let uploadedPathname = ''
    try {
      const blob = await createCroppedImage(source, cropArea, rotation, flipped, filter, target)
      const file = new File([blob], `${target}-${crypto.randomUUID()}.webp`, { type: 'image/webp' })
      const uploaded = await upload(`users/${user.id}/profile/${crypto.randomUUID()}`, file, {
        access: 'private',
        handleUploadUrl: '/api/media/upload',
        clientPayload: JSON.stringify({ purpose: target === 'banner' ? 'banner' : 'profile' }),
        contentType: 'image/webp',
      })
      uploadedPathname = uploaded.pathname
      if (target === 'banner') {
        await updateProfileBannerAction(uploaded.pathname)
        onBannerChange(mediaUrl(uploaded.pathname))
        onStatus('Your profile banner has been updated.')
      } else {
        await updateProfilePhotoAction(uploaded.pathname)
        onImageChange(mediaUrl(uploaded.pathname))
        onStatus('Your profile photo has been updated.')
      }
      setSource(null)
      router.refresh()
    } catch {
      if (uploadedPathname) await discardMediaUploadsAction([uploadedPathname]).catch(() => undefined)
      onStatus(`Your ${target === 'banner' ? 'profile banner' : 'profile photo'} could not be updated. Please try again.`, true)
    } finally {
      setSaving(false)
    }
  }

  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'
  const selectedFilter = photoFilters.find((item) => item.id === filter)?.css ?? 'none'
  const isSquareAvatar = avatarDecoration === 'square'

  return (
    <div className="avatar-studio">
      <section className="profile-card-preview" aria-label="Live profile card preview">
        <div className="profile-card-cover" style={bannerImage ? { backgroundImage: `url("${bannerImage}")` } : undefined}>
          {!bannerImage ? <span>MAKE YOUR CORNER YOURS</span> : null}
          <label className="profile-banner-edit">
            <ImagePlus aria-hidden="true" /><span>Change cover</span>
            <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif" aria-label="Choose a profile banner" onChange={(event) => chooseImage('banner', event)} disabled={saving} />
          </label>
        </div>
        <div className="profile-card-preview-body">
          <div className={`profile-card-avatar avatar-decoration-${avatarDecoration}`}>
            {image ? <img src={image} alt={`${name || user.name}'s avatar`} referrerPolicy="no-referrer" /> : <span aria-hidden="true">{initials}</span>}
          </div>
          <div className="profile-card-preview-heading">
            <span className="profile-card-role">{user.isAdmin ? 'F.R.I.E.N.D.S creator' : 'Community member'}</span>
            <strong>{name || user.name}</strong>
            <span>@{username || user.username}</span>
          </div>
          <p className="profile-card-about">{about || 'Add a little about yourself.'}</p>
          <div className="profile-card-preview-footer">
            <span>Joined {new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(new Date(user.createdAt))}</span>
            <label className="settings-photo-button">
              <ImagePlus aria-hidden="true" /><span>{saving && target === 'avatar' ? 'Saving…' : 'Change avatar'}</span>
              <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif" aria-label="Choose a profile photo" aria-describedby="profile-studio-help" onChange={(event) => chooseImage('avatar', event)} disabled={saving} />
            </label>
          </div>
        </div>
      </section>

      <div className="avatar-decoration-section">
        <div className="avatar-studio-heading"><strong>Avatar style</strong><span>Choose a frame for your profile.</span></div>
        <div className="avatar-decoration-grid" role="radiogroup" aria-label="Avatar style">
          {decorations.map((decoration) => (
            <button
              className={`avatar-decoration-option${avatarDecoration === decoration.id ? ' selected' : ''}`}
              type="button"
              role="radio"
              aria-checked={avatarDecoration === decoration.id}
              key={decoration.id}
              disabled={styleSaving}
              onClick={() => void saveDecoration(decoration.id)}
            >
              <span className={`avatar-style-sample avatar-decoration-${decoration.id}`} aria-hidden="true">{initials}</span>
              <strong>{decoration.label}</strong><small>{decoration.description}</small>
            </button>
          ))}
        </div>
      </div>
      <p id="profile-studio-help" className="settings-photo-help">Photos: JPG, PNG, WebP, or GIF up to 5 MB. Covers: up to 8 MB. Images are cropped and stored privately.</p>

      {source ? (
        <div className="crop-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setSource(null) }}>
          <section className="crop-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-editor-title">
            <header className="crop-editor-header">
              <div><p className="inbox-kicker">PROFILE STUDIO</p><h3 id="crop-editor-title">{target === 'banner' ? 'Edit your cover' : 'Edit your avatar'}</h3></div>
              <button className="icon-button" type="button" aria-label="Close image editor" onClick={() => setSource(null)} disabled={saving}><X aria-hidden="true" /></button>
            </header>
            <div className={`crop-editor-stage crop-editor-${target}`}>
              <Cropper
                image={source}
                crop={crop}
                zoom={zoom}
                rotation={rotation}
                aspect={target === 'banner' ? 3.1 : 1}
                cropShape={target === 'avatar' && !isSquareAvatar ? 'round' : 'rect'}
                showGrid
                minZoom={1}
                maxZoom={4}
                zoomSpeed={0.15}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onRotationChange={setRotation}
                onCropComplete={(_, area) => setCropArea(area)}
                transform={`translate(${crop.x}px, ${crop.y}px) rotate(${rotation}deg) scale(${zoom}) scaleX(${flipped ? -1 : 1})`}
                style={{ containerStyle: { backgroundColor: '#090f0d' }, mediaStyle: { filter: selectedFilter } }}
                mediaProps={{ alt: '', draggable: false }}
              />
            </div>
            <div className="crop-editor-controls">
              <label className="crop-zoom-control" htmlFor="crop-zoom"><span>Zoom</span><input id="crop-zoom" type="range" min="1" max="4" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
              <div className="crop-action-row">
                <button className="crop-control-button" type="button" onClick={() => setRotation((value) => (value + 270) % 360)} aria-label="Rotate left"><RotateCcw aria-hidden="true" />Rotate left</button>
                <button className="crop-control-button" type="button" onClick={() => setRotation((value) => (value + 90) % 360)} aria-label="Rotate right"><RotateCw aria-hidden="true" />Rotate right</button>
                <button className={`crop-control-button${flipped ? ' selected' : ''}`} type="button" onClick={() => setFlipped((value) => !value)} aria-pressed={flipped}>Mirror</button>
              </div>
              <div className="crop-filter-row" role="group" aria-label="Photo filter">
                {photoFilters.map((item) => <button className={filter === item.id ? 'selected' : ''} type="button" aria-pressed={filter === item.id} key={item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}
              </div>
              <footer className="crop-editor-footer">
                <button className="settings-secondary-button" type="button" onClick={() => setSource(null)} disabled={saving}>Cancel</button>
                <button className="solid-button" type="button" onClick={() => void saveCrop()} disabled={saving || !cropArea}><Check aria-hidden="true" />{saving ? 'Saving…' : 'Apply crop'}</button>
              </footer>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
