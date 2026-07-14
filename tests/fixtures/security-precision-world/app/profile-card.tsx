export function ProfileCard({ rawUserBio }: { rawUserBio: string }) {
  return <div dangerouslySetInnerHTML={{ __html: rawUserBio }} />;
}
