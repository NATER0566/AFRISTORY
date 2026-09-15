import mongoose from 'mongoose';

export const GENRES = [
  'Action',
  'Drama',
  'Comedy',
  'Romance',
  'Thriller',
  'Sci-Fi',
  'Horror',
  'Documentary',
  'Afro-Futurism',
  'Folklore',
  'Urban Drama',
  'Animation',
  'Historical',
  'Adventure',
  'Mystery',
  'Crime',
  'Family',
  'Faith & Inspirational',
  'Musical',
  'Biography',
  'Short Film',
];

export const LANGUAGES = [
  'English',
  'Nigerian Pidgin',
  'Tiv',
  'Igbo',
  'Yoruba',
  'Hausa',
  'Edo',
  'Idoma',
  'Efik',
  'Ibibio',
  'Nupe',
  'Gbagyi',
  'Berom',
  'Mada',
  'Fulfulde',
  'Kanuri',
  'Igala',
  'Ijaw',
  'Urhobo',
  'Isoko',
  'Esan',
  'Jukun',
  'French',
  'Arabic',
  'Swahili',
  'Amharic',
  'Wolof',
  'Zulu',
  'Xhosa',
  'Shona',
  'Other Nigerian Language',
  'Other African Language',
  'Other',
];

const CONTENT_TYPES = ['Series', 'Movie', 'Short Film', 'Documentary', 'Animation', 'Mini-Series', 'Web Series'];
const AGE_RATINGS = ['General', '7+', '10+', '13+', '16+', '18+'];
const CONTENT_WARNINGS = ['Violence', 'Strong Language', 'Sexual Content', 'Horror', 'Drug Use', 'Disturbing Scenes'];

const normalizedStringArray = {
  type: [
    {
      type: String,
      trim: true,
    },
  ],
  default: [],
};

const seriesSchema = new mongoose.Schema(
  {
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Creator',
      required: true,
    },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Creator',
      default: null,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    slug: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
      index: true,
    },
    description: {
      type: String,
      default: '',
      maxlength: 2000,
    },
    coverImage: {
      type: String,
      required: true,
    },
    posterUrl: {
      type: String,
      default: null,
    },
    trailerUrl: {
      type: String,
      default: null,
    },
    contentType: {
      type: String,
      enum: CONTENT_TYPES,
      default: 'Series',
      index: true,
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    status: {
      type: String,
      enum: ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED', 'ARCHIVED', 'ONGOING', 'COMPLETED'],
      default: 'DRAFT',
      index: true,
    },
    followers: {
      type: Number,
      default: 0,
    },
    totalViews: {
      type: Number,
      default: 0,
    },
    totalEpisodes: {
      type: Number,
      default: 0,
    },
    rating: {
      type: mongoose.Decimal128,
      default: 0.0,
    },
    genre: {
      type: String,
      default: null,
    },
    primaryGenre: {
      type: String,
      enum: GENRES,
      default: null,
      index: true,
    },
    secondaryGenres: {
      ...normalizedStringArray,
      validate: {
        validator: values => values.every(value => GENRES.includes(value)),
        message: 'Secondary genres must use supported genre values',
      },
      index: true,
    },
    culture: {
      ...normalizedStringArray,
      index: true,
    },
    language: {
      type: String,
      enum: LANGUAGES,
      default: 'English',
      index: true,
    },
    additionalLanguages: {
      ...normalizedStringArray,
      validate: {
        validator: values => values.every(value => LANGUAGES.includes(value)),
        message: 'Additional languages must use supported language values',
      },
    },
    country: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    region: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    themes: {
      ...normalizedStringArray,
      index: true,
    },
    subtitleLanguages: {
      ...normalizedStringArray,
      validate: {
        validator: values => values.every(value => LANGUAGES.includes(value) || value === 'Other'),
        message: 'Subtitle languages must use supported language values',
      },
    },
    ageRating: {
      type: String,
      enum: AGE_RATINGS,
      default: 'General',
    },
    contentWarnings: {
      ...normalizedStringArray,
      validate: {
        validator: values => values.every(value => CONTENT_WARNINGS.includes(value)),
        message: 'Content warnings must use supported warning values',
      },
    },
    accessType: {
      type: String,
      enum: ['Free', 'Premium', 'Free Preview + Premium'],
      default: 'Free',
      index: true,
    },
    unlockPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
    seasons: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    views: {
      type: Number,
      min: 0,
      default: 0,
    },
    likes: {
      type: Number,
      min: 0,
      default: 0,
    },
    isPublished: {
      type: Boolean,
      default: false,
    },
    isPremiumExclusive: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Index for better query performance
seriesSchema.index({ creatorId: 1, status: 1 });
seriesSchema.index({ title: 'text', description: 'text', tags: 'text' });

export default mongoose.model('Series', seriesSchema);
