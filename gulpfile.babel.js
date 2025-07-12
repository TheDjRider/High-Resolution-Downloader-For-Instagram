import gulp from 'gulp';
import loadPlugins from 'gulp-load-plugins';
import webpack from 'webpack';
import rimraf from 'rimraf';

const plugins = loadPlugins();
import contentWebpackConfig from './content/webpack.config';

function clean(cb) {
  rimraf('./build', cb);
}

function contentJs(cb) {
  webpack(contentWebpackConfig, (err, stats) => {
    if (err) throw new plugins.util.PluginError('webpack', err);
    plugins.util.log('[webpack]', stats.toString());
    cb();
  });
}

function copyManifest() {
  return gulp.src('manifest.json').pipe(gulp.dest('./build'));
}

function copyLocales() {
  return gulp
    .src(['./_locales/**/*'], { base: '.' })
    .pipe(gulp.dest('./build'));
}

const build = gulp.series(
  clean,
  gulp.parallel(copyManifest, copyLocales, contentJs)
);

function watch() {
  gulp.watch('content/**/*', build);
  gulp.watch('injected_script.js', build);
}

gulp.task('clean', clean);
gulp.task('content-js', contentJs);
gulp.task('copy-manifest', copyManifest);
gulp.task('copy-locales', copyLocales);
gulp.task('build', build);
gulp.task('watch', gulp.series(build, watch));
gulp.task('default', build);
