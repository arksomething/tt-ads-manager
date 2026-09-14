import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

type ReactNativeWebExports = typeof import('react-native') & {
  AppRegistry: {
    registerComponent(
      appKey: string,
      getComponentFunc: () => React.ComponentType<any>
    ): string;
    getApplication(appKey: string): {
      element: React.ReactElement;
      getStyleElement(): React.ReactElement;
    };
  };
};

const {
  AppRegistry,
  Image,
  StyleSheet,
  Text,
  View,
} = require('react-native-web') as ReactNativeWebExports;

export interface ProjectionMarkupData {
  currentHeight: string;
  predictedHeight: string;
  heightGain: number;
  unitLabel: string;
  issuesCount: number;
  issuesWord: string;
  reasons: string[];
  growthComplete: number;
  dreamProbability?: number;
  percentileDisplay: string;
  currentAge: number;
  progressPercent: number;
  iconDataUrl?: string;
}

const SCREEN_WIDTH = 430;
const DEVICE_SCREEN_HEIGHT = 932;
const SAFE_AREA_TOP = 59;
const SAFE_AREA_BOTTOM = 34;
// The bot render does not include the iOS status/dynamic-island region,
// so capture only the app-visible area below the top safe area.
const SCREEN_HEIGHT = DEVICE_SCREEN_HEIGHT - SAFE_AREA_TOP;
const CONTENT_HORIZONTAL_PADDING = 24;
const GRAPH_HEIGHT = 110;
const LABEL_COLUMN_WIDTH = 58;
const MIN_LEFT_GUTTER = LABEL_COLUMN_WIDTH + 4;
const MAX_LEFT_GUTTER = 100;
const LABEL_FONT_SIZE = 14;
const LABEL_LINE_HEIGHT = 20;
const LABEL_HIGHLIGHT_HEIGHT = 24;
const PREDICTED_GLOW_COLORS = [
  '#8ef351',
  '#8ef351',
  '#8ef351',
  '#8ef351',
  '#8ef351',
  '#8ef351',
] as const;
const GLOW_PADDING = 300;
const GLOW_REFERENCE_HEIGHT = 88;

function clampPercentage(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, Math.round(value as number)));
}

function BackIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 21 21" fill="none">
      <path
        d="M19.7621 10.1739H1.4142M1.4142 10.1739L10.5881 19.3479M1.4142 10.1739L10.5881 1"
        stroke="#F8F8F8"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M9 6L15 12L9 18"
        stroke="#0c0c0d"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GlowBackgroundWeb({
  colors = PREDICTED_GLOW_COLORS as unknown as string[],
  cornerRadius = 24,
}: {
  colors?: string[];
  cornerRadius?: number;
}) {
  const scale = Math.max(0.5, GLOW_REFERENCE_HEIGHT / 78) * 0.08;
  const glowColor = colors[0] ?? '#8ef351';
  const canvasStyle: React.CSSProperties = {
    position: 'absolute',
    top: -GLOW_PADDING,
    right: -GLOW_PADDING,
    bottom: -GLOW_PADDING,
    left: -GLOW_PADDING,
  };
  const layerStyle = (blur: number, opacity: number): React.CSSProperties => ({
    position: 'absolute',
    top: GLOW_PADDING,
    right: GLOW_PADDING,
    bottom: GLOW_PADDING,
    left: GLOW_PADDING,
    borderRadius: cornerRadius,
    backgroundColor: glowColor,
    filter: `blur(${blur}px)`,
    opacity,
    mixBlendMode: 'screen',
  });

  return (
    <View
      style={[
        StyleSheet.absoluteFillObject,
        { pointerEvents: 'none', overflow: 'visible' },
      ] as any}
    >
      <div style={canvasStyle}>
        <div style={layerStyle(63.61 * scale, 0.4)} />
        <div style={layerStyle(222.63 * scale, 0.2)} />
        <div style={layerStyle(12.72 * scale, 0.4)} />
      </div>
    </View>
  );
}

function DreamOddsGraph({
  dreamProbability,
  growthComplete,
  currentAge,
  width,
}: {
  dreamProbability?: number;
  growthComplete?: number;
  currentAge: number;
  width: number;
}) {
  const dynamicInsetMax = MAX_LEFT_GUTTER;
  const dynamicInsetMin = MIN_LEFT_GUTTER;
  const startX = Math.min(
    dynamicInsetMax,
    Math.max(dynamicInsetMin, width * 0.16)
  );
  const graphWidth = Math.max(0, width - startX);
  const graphCenterX = startX + graphWidth / 2;
  const endX = startX + graphWidth;
  const startY = GRAPH_HEIGHT;
  const endY = GRAPH_HEIGHT * 0.05;
  const controlPoint1 = {
    x: startX + graphWidth / 3,
    y: GRAPH_HEIGHT - GRAPH_HEIGHT * 0.55,
  };
  const controlPoint2 = {
    x: startX + (2 * graphWidth) / 3,
    y: GRAPH_HEIGHT * 0.2,
  };

  const computeCubicValue = (
    p0: number,
    p1: number,
    p2: number,
    p3: number,
    t: number
  ) => {
    const mt = 1 - t;
    return (
      mt * mt * mt * p0 +
      3 * mt * mt * t * p1 +
      3 * mt * t * t * p2 +
      t * t * t * p3
    );
  };

  const centerY = computeCubicValue(
    startY,
    controlPoint1.y,
    controlPoint2.y,
    endY,
    0.5
  );
  const labelHighlightTop = Math.max(
    0,
    Math.min(
      GRAPH_HEIGHT - LABEL_HIGHLIGHT_HEIGHT,
      centerY - LABEL_HIGHLIGHT_HEIGHT / 2
    )
  );
  const path = `M ${startX} ${startY} C ${controlPoint1.x} ${controlPoint1.y}, ${controlPoint2.x} ${controlPoint2.y}, ${endX} ${endY}`;
  const oddsDisplay = `${Math.round(dreamProbability ?? 50)}%`;
  const growthDisplay = `${Math.round(growthComplete ?? 85)}%`;
  const age = Math.floor(currentAge);
  const prevAge = age - 1;
  const nextAge = age + 1;

  const BlurSvgText = ({
    text,
    width: blurWidth,
    height,
    fontSize = 16,
    align = 'center',
    fill = 'rgba(255,255,255,0.6)',
  }: {
    text: string;
    width?: number;
    height?: number;
    fontSize?: number;
    align?: 'center' | 'left';
    fill?: string;
  }) => {
    const filterId = `blur-${text}-${fontSize}-${align}`;
    const clipId = `clip-${text}-${fontSize}-${align}`;
    const computedWidth = blurWidth ?? Math.max(40, text.length * fontSize * 0.8);
    const computedHeight = height ?? Math.ceil(fontSize * 1.6);
    const paddingX = align === 'center' ? 0 : fontSize * 0.2;
    const textX = align === 'center' ? computedWidth / 2 : paddingX;
    const anchor = align === 'center' ? 'middle' : 'start';

    return (
      <svg width={computedWidth} height={computedHeight} style={graphStyles.blurSvg as any}>
        <defs>
          <clipPath id={clipId}>
            <rect
              x={0}
              y={0}
              width={computedWidth}
              height={computedHeight}
              rx={computedHeight / 2}
              ry={computedHeight / 2}
            />
          </clipPath>
          <filter id={filterId} filterUnits="userSpaceOnUse">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <text
            x={textX}
            y={computedHeight / 2}
            fill={fill}
            fontSize={fontSize}
            fontWeight="500"
            textAnchor={anchor}
            alignmentBaseline="middle"
            filter={`url(#${filterId})`}
            opacity={0.95}
          >
            {text}
          </text>
        </g>
      </svg>
    );
  };

  const renderXAxisAge = (value: number) => (
    <Text style={graphStyles.xAxisText}>{value}</Text>
  );

  return (
    <View style={graphStyles.container}>
      <View style={graphStyles.legendContainer}>
        <View style={graphStyles.legendDot} />
        <Text style={graphStyles.legendText}>Growth graph</Text>
      </View>

      <View style={graphStyles.row}>
        <View style={[graphStyles.graphArea, { width }]}>
          <View style={graphStyles.yAxisLabels}>
            <Text style={[graphStyles.labelDisabled, graphStyles.labelTop]}>100%</Text>
            <View style={[graphStyles.labelHighlightContainer, { top: labelHighlightTop }]}>
              <Text style={graphStyles.labelHighlight}>{growthDisplay}</Text>
            </View>
            <Text style={[graphStyles.labelDisabled, graphStyles.labelBottom]}>0%</Text>
          </View>

          <svg
            height={GRAPH_HEIGHT}
            width={width}
            style={StyleSheet.absoluteFillObject as any}
          >
            <defs>
              <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="white" stopOpacity="0.1" />
                <stop offset="1" stopColor="white" stopOpacity="0.1" />
              </linearGradient>
              <radialGradient
                id="glowGradient"
                cx="50%"
                cy="50%"
                rx="50%"
                ry="50%"
                fx="50%"
                fy="50%"
                gradientUnits="objectBoundingBox"
              >
                <stop offset="0" stopColor="#8387E9" stopOpacity="0.6" />
                <stop offset="1" stopColor="#8387E9" stopOpacity="0" />
              </radialGradient>
            </defs>

            <line
              x1={startX}
              y1="0"
              x2={endX}
              y2="0"
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="1"
            />
            <line
              x1={startX}
              y1={centerY}
              x2={graphCenterX}
              y2={centerY}
              stroke="#8ef351"
              strokeWidth="1"
              strokeDasharray="6 6"
              strokeOpacity="0.8"
            />
            <line
              x1={startX}
              y1={GRAPH_HEIGHT}
              x2={endX}
              y2={GRAPH_HEIGHT}
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="1"
            />
            <path d={path} fill="none" stroke="#8ef351" strokeWidth="3" />
            <line
              x1={graphCenterX}
              y1={centerY}
              x2={graphCenterX}
              y2={GRAPH_HEIGHT}
              stroke="#8387E9"
              strokeWidth="2"
              strokeDasharray="6 6"
            />
            <circle cx={graphCenterX} cy={centerY} r={20} fill="url(#glowGradient)" />
            <circle
              cx={graphCenterX}
              cy={centerY}
              r={6}
              fill="#8ef351"
              stroke="#fff"
              strokeWidth="2"
            />
          </svg>

          <View style={[graphStyles.tooltip, { right: 0, bottom: '100%', marginBottom: 10 } as any]}>
            <Text style={graphStyles.tooltipLabel}>Dream Odds:</Text>
            <Text style={graphStyles.tooltipValue}>{oddsDisplay}</Text>
            <View style={graphStyles.tooltipArrow} />
          </View>
        </View>
      </View>

      <View style={graphStyles.xAxisContainer}>
        <View style={[graphStyles.xAxisLabels, { marginLeft: startX }]}>
          {renderXAxisAge(prevAge)}
          <View style={graphStyles.ageHighlight}>
            <View style={graphStyles.ageBadge}>
              <Text style={graphStyles.ageTextActive}>{age}</Text>
            </View>
          </View>
          {renderXAxisAge(nextAge)}
        </View>
      </View>
    </View>
  );
}

function ProjectionButton({ title }: { title: string }) {
  return (
    <View style={buttonStyles.outer}>
      <View style={buttonStyles.gradientLayer as any} />
      <View style={buttonStyles.content}>
        <Text style={buttonStyles.label}>{title}</Text>
        <ChevronIcon />
      </View>
    </View>
  );
}

function ProjectionStaticScreen(props: ProjectionMarkupData) {
  const progressPercent = clampPercentage(props.progressPercent, 85);
  const growthComplete = clampPercentage(props.growthComplete, 85);
  const dreamProbability = clampPercentage(props.dreamProbability, 50);
  const contentWidth = SCREEN_WIDTH - CONTENT_HORIZONTAL_PADDING * 2;
  const issueLabel = `${props.issuesCount} ${props.issuesWord} found`;
  const reasons = props.reasons.length
    ? props.reasons
    : ['Your growth pace looks on track for your stage.'];

  return (
    <View style={layoutStyles.viewport}>
      <View style={layoutStyles.container}>
        <View style={[layoutStyles.safeArea, { paddingTop: SAFE_AREA_TOP }]}>
          <View style={layoutStyles.header}>
            <View style={layoutStyles.backButton}>
              <View style={layoutStyles.backButtonCircle}>
                <BackIcon />
              </View>
            </View>

            <View style={layoutStyles.progressContainer}>
              <View style={layoutStyles.progressBar}>
                <View style={[layoutStyles.progressFill, { width: `${progressPercent}%` } as any]} />
              </View>
            </View>
          </View>

          <View style={[layoutStyles.titleContainer, { marginBottom: 24 }]}>
            <View style={screenStyles.titleContainer}>
              <Text style={screenStyles.titleText}>GoTall</Text>
              {props.iconDataUrl ? (
                <Image
                  source={{ uri: props.iconDataUrl }}
                  style={screenStyles.titleIcon}
                />
              ) : null}
            </View>
          </View>

          <View style={layoutStyles.scrollContent}>
            <View style={[layoutStyles.scrollContentContainer, { paddingHorizontal: CONTENT_HORIZONTAL_PADDING }]}>
              <View style={screenStyles.container}>
                <View style={screenStyles.section}>
                  <View style={screenStyles.metricsContainer}>
                    <View style={[screenStyles.metricBox, screenStyles.metricBoxLarge]}>
                      <Text style={screenStyles.metricLabel}>Current height</Text>
                      <Text style={[screenStyles.metricValue, screenStyles.heightValue]}>
                        {props.currentHeight}
                      </Text>
                    </View>

                    <View
                      style={[
                        screenStyles.metricBox,
                        screenStyles.metricBoxLarge,
                        screenStyles.metricBoxPredicted,
                      ]}
                    >
                      <View
                        style={[
                          StyleSheet.absoluteFillObject,
                          {
                            backgroundColor: '#8ef351',
                            borderRadius: 16,
                            borderWidth: 1,
                            borderColor: 'rgba(255,255,255,0.12)',
                          },
                        ]}
                      />
                      <View
                        style={[
                          StyleSheet.absoluteFillObject,
                          { overflow: 'visible', borderRadius: 16 },
                        ]}
                      >
                        <GlowBackgroundWeb colors={[...PREDICTED_GLOW_COLORS]} />
                      </View>
                      <Text style={[screenStyles.metricLabel, screenStyles.predictedLabel]}>
                        Predicted height
                      </Text>
                      <Text style={[screenStyles.metricValue, screenStyles.predictedValue]}>
                        {props.predictedHeight}
                      </Text>
                    </View>
                  </View>

                  <View style={screenStyles.optimizeContainer}>
                    <Text style={screenStyles.optimizeText}>
                      Optimize up to <Text style={screenStyles.highlight}>{props.heightGain}</Text>{' '}
                      {props.unitLabel}
                    </Text>
                  </View>

                  <View style={screenStyles.reasonsCard}>
                    <View style={screenStyles.reasonsHeader}>
                      <Text style={screenStyles.reasonsTitle}>What's Holding You Back:</Text>
                      <View style={screenStyles.issuesBadge}>
                        <Text style={screenStyles.issuesBadgeText}>{issueLabel}</Text>
                      </View>
                    </View>
                    <View style={{ gap: 8 } as any}>
                      {reasons.slice(0, 3).map((message, index) => (
                        <Text key={`reason-${index}`} style={screenStyles.reasonTextLine}>
                          • {message}
                        </Text>
                      ))}
                    </View>
                  </View>

                  <DreamOddsGraph
                    currentAge={props.currentAge}
                    dreamProbability={dreamProbability}
                    growthComplete={growthComplete}
                    width={contentWidth}
                  />

                  <View style={screenStyles.optimizeContainer}>
                    <Text style={screenStyles.optimizeText}>
                      Taller than <Text style={screenStyles.highlight}>{props.percentileDisplay}%</Text>{' '}
                      of your age
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </View>

          <View style={[layoutStyles.footer, { paddingBottom: SAFE_AREA_BOTTOM }]}>
            <View style={layoutStyles.buttonContainer}>
              <ProjectionButton title="Continue" />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const layoutStyles = StyleSheet.create({
  viewport: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    backgroundColor: '#000',
  },
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  safeArea: {
    flex: 1,
  },
  header: {
    paddingTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
  },
  progressContainer: {
    flex: 1,
    paddingVertical: 24,
    paddingRight: 12,
  },
  progressBar: {
    height: 10,
    backgroundColor: 'rgba(45, 45, 45, 0.3)',
    borderRadius: 24,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#8ef351',
    borderRadius: 24,
  },
  backButton: {
    alignSelf: 'center',
  },
  backButtonCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#111',
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleContainer: {
    paddingHorizontal: 16,
  },
  scrollContent: {
    flex: 1,
  },
  scrollContentContainer: {
    paddingBottom: 24,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    backgroundColor: '#000',
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  buttonContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
});

const buttonStyles = StyleSheet.create({
  outer: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#89ff58',
    backgroundColor: '#2afd49',
    boxShadow: '0px 4px 12px rgba(40, 224, 51, 0.35)',
    overflow: 'hidden',
  },
  gradientLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundImage: 'linear-gradient(180deg, #8ef351 0%, #2afd49 100%)',
  },
  content: {
    minHeight: 60,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  label: {
    color: '#0c0c0d',
    fontSize: 18,
    fontWeight: '700',
  },
});

const screenStyles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    backgroundColor: '#000',
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: -24,
    marginTop: -8,
  },
  titleText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
  },
  titleIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    marginLeft: 8,
  },
  section: {
    paddingHorizontal: 0,
    marginTop: 0,
    marginBottom: 0,
    gap: 12,
  },
  metricsContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: 0,
    marginHorizontal: 0,
    gap: 12,
    marginTop: 24,
  },
  metricBox: {
    flex: 1,
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 0,
    alignItems: 'center',
  },
  metricBoxLarge: {
    paddingVertical: 20,
    minHeight: 88,
    justifyContent: 'center',
  },
  metricBoxPredicted: {
    backgroundColor: 'transparent',
    overflow: 'visible',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 20,
    justifyContent: 'center',
  },
  metricLabel: {
    color: '#FFF',
    fontSize: 16,
    marginBottom: 8,
    textAlign: 'center',
    fontWeight: '600',
  },
  predictedLabel: {
    color: '#000',
    fontSize: 16,
    marginBottom: 8,
    textAlign: 'center',
    fontWeight: '600',
    lineHeight: undefined,
  },
  metricValue: {
    color: '#FFF',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  optimizeContainer: {
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 16,
    marginBottom: 0,
    alignItems: 'center',
  },
  optimizeText: {
    color: '#FFF',
    fontSize: 16,
    textAlign: 'center',
  },
  highlight: {
    color: '#8ef351',
    fontWeight: 'bold',
  },
  heightValue: {
    color: '#8ef351',
    fontSize: 24,
    fontWeight: 'bold',
  },
  predictedValue: {
    color: '#000',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  reasonsCard: {
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 16,
    marginTop: 0,
    overflow: 'hidden',
  },
  reasonsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  reasonsTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  issuesBadge: {
    backgroundColor: '#991b1b',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  issuesBadgeText: {
    color: '#ff4d4f',
    fontSize: 12,
    fontWeight: '700',
  },
  reasonTextLine: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
  },
});

const graphStyles = StyleSheet.create({
  container: {
    width: '100%',
    marginBottom: 16,
    marginTop: 6,
  },
  row: {
    flexDirection: 'row',
    height: GRAPH_HEIGHT,
    alignItems: 'stretch',
  },
  yAxisLabels: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: LABEL_COLUMN_WIDTH,
    paddingRight: 8,
    zIndex: 20,
    alignItems: 'flex-start',
    paddingVertical: 0,
  },
  labelHighlightContainer: {
    position: 'absolute',
    left: 0,
    height: LABEL_HIGHLIGHT_HEIGHT,
    justifyContent: 'center',
    width: '100%',
    zIndex: 2,
  },
  labelDisabled: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: LABEL_FONT_SIZE,
    fontWeight: '500',
    lineHeight: LABEL_LINE_HEIGHT,
    textAlign: 'left',
    width: '100%',
  },
  labelHighlight: {
    color: '#8ef351',
    fontSize: LABEL_FONT_SIZE,
    fontWeight: 'bold',
    lineHeight: LABEL_LINE_HEIGHT,
    textAlign: 'left',
    width: '100%',
  },
  labelTop: {
    position: 'absolute',
    top: -LABEL_LINE_HEIGHT / 2,
  },
  labelBottom: {
    position: 'absolute',
    bottom: -LABEL_LINE_HEIGHT / 2,
  },
  graphArea: {
    flex: 1,
    position: 'relative',
  },
  tooltip: {
    position: 'absolute',
    backgroundColor: '#111',
    borderRadius: 12,
    paddingTop: 10,
    paddingBottom: 6,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 30,
  },
  tooltipLabel: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
  },
  tooltipValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  tooltipArrow: {
    position: 'absolute',
    bottom: -6,
    right: 14,
    width: 12,
    height: 12,
    backgroundColor: '#111',
    transform: [{ rotate: '45deg' }],
  },
  xAxisContainer: {
    flexDirection: 'row',
    marginTop: 8,
  },
  xAxisLabels: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 0,
    alignItems: 'center',
  },
  xAxisText: {
    color: '#5B5B5B',
    fontSize: 14,
    fontWeight: '500',
  },
  blurSvg: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ageHighlight: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ageBadge: {
    backgroundColor: '#8387E9',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  ageTextActive: {
    color: '#000',
    fontSize: 14,
    fontWeight: '600',
  },
  legendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    marginLeft: 0,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#8ef351',
    marginRight: 8,
  },
  legendText: {
    color: '#9C9C9C',
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'left',
  },
});

export function renderProjectionMarkup(data: ProjectionMarkupData): string {
  const appName = 'ProjectionStaticApp';
  const App = () => <ProjectionStaticScreen {...data} />;

  AppRegistry.registerComponent(appName, () => App);
  const { element, getStyleElement } = AppRegistry.getApplication(appName);
  const styleMarkup = renderToStaticMarkup(getStyleElement());
  const bodyMarkup = renderToStaticMarkup(element);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>GoTall Projection</title>
    ${styleMarkup}
    <style>
      html, body {
        width: ${SCREEN_WIDTH}px;
        height: ${SCREEN_HEIGHT}px;
        margin: 0;
        background: #000;
        overflow: hidden;
      }
      #root {
        width: ${SCREEN_WIDTH}px;
        height: ${SCREEN_HEIGHT}px;
      }
    </style>
  </head>
  <body>
    <div id="root">${bodyMarkup}</div>
  </body>
</html>`;
}
