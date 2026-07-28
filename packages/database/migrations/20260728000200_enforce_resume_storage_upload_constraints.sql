update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['application/pdf']
where id = 'candidate-resumes';
